/**
 * Structured server-side logging for the Google boundary.
 *
 * Purpose: a failed provisioning run must be traceable after the fact. Every
 * Google API call logs the operation that failed, the HTTP status, Google's own
 * error code, and a sanitized reason, all tied to a correlation id that is also
 * shown to the user as a support reference.
 *
 * Secrets policy: this module is the only place that decides what may be
 * written. It emits an explicit allow-list of fields and scrubs token-shaped
 * values, so an access token, refresh token, authorization code, client secret,
 * cookie, or user email can never reach the log. Raw Google response bodies are
 * never logged.
 *
 * The Google message is sanitized rather than dropped because it is the only
 * place the actionable cause lives (for example which Google Cloud project is
 * missing an API).
 */

import { createRandomToken } from "@/lib/google/crypto";

/** Correlation ids are random, URL-safe, and carry no information. */
const CORRELATION_ID_BYTES = 16;

const MAX_REASON_LENGTH = 300;

/** Request-scoped context threaded through every Google call. */
export type GoogleCallContext = {
  correlationId: string;
};

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/ya29\.[A-Za-z0-9._-]+/g, "[redacted-token]"],
  // Google refresh tokens are `1//` followed by base64url characters.
  [/1\/\/[A-Za-z0-9._-]{20,}/g, "[redacted-refresh-token]"],
  [/\b4\/[A-Za-z0-9._-]{20,}/g, "[redacted-auth-code]"],
  [/\bGOCSPX-[A-Za-z0-9._-]+/g, "[redacted-client-secret]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, "[redacted-authorization]"],
];

/**
 * Scrub credential-shaped substrings and cap the length of anything derived
 * from a Google response before it is written to a log.
 */
export function sanitizeLogReason(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  let out = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_REASON_LENGTH
    ? `${out.slice(0, MAX_REASON_LENGTH)}...[truncated]`
    : out;
}

export function createCorrelationId(): string {
  return createRandomToken(CORRELATION_ID_BYTES);
}

function emit(level: "info" | "error", payload: Record<string, unknown>): void {
  const line = JSON.stringify({ level, ...payload });
  if (level === "error") {
    console.error(`[google] ${line}`);
  } else {
    console.info(`[google] ${line}`);
  }
}

/**
 * Log a failed Google API call. Called from the transport layer, which knows
 * the operation but nothing about the user's business outcome.
 */
export function logGoogleApiFailure(input: {
  correlationId: string;
  operation: string;
  status: number;
  googleCode: string | null;
  reason: string;
}): void {
  emit("error", {
    event: "google_api_failure",
    correlationId: input.correlationId,
    operation: input.operation,
    status: input.status,
    googleCode: input.googleCode,
    reason: sanitizeLogReason(input.reason),
  });
}

/**
 * Log a Google boundary event that is not a single API call: the provisioning
 * run, cleanup after a partial failure, and registry persistence.
 *
 * The extra fields are an allow-list enforced at runtime, not just by the
 * TypeScript type, so a new caller cannot smuggle an arbitrary value into the
 * log. Every allowed string still goes through the same scrubbing used for
 * reasons, because Google's own error strings are not trusted input.
 */
const ALLOWED_EVENT_FIELDS = [
  "operation",
  "googleCode",
  "googleErrorKind",
  "status",
  "appName",
  "userId",
  "spreadsheetId",
  "scriptId",
  "deploymentId",
  "spreadsheetCreated",
] as const;

export type GoogleLogEvent = {
  correlationId: string;
  event: string;
  level?: "info" | "error";
  reason?: string;
  detail?: string;
  operation?: string;
  /** Machine-readable code Google reported, when any. */
  googleCode?: string | null;
  /** Normalized diagnosis, so a log line is readable without the code table. */
  googleErrorKind?: string;
  status?: number | string | null;
  appName?: string;
  userId?: string;
  spreadsheetId?: string;
  scriptId?: string;
  deploymentId?: string;
  /** Whether a Google resource had to be cleaned up after a failure. */
  spreadsheetCreated?: boolean;
};

export function logGoogleEvent(input: GoogleLogEvent): void {
  const { correlationId, event, level = "info", reason, detail } = input;
  const allowed: Record<string, unknown> = {};
  for (const key of ALLOWED_EVENT_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    allowed[key] = typeof value === "string" ? sanitizeLogReason(value) : value;
  }
  emit(level, {
    event,
    correlationId,
    ...allowed,
    ...(reason === undefined ? {} : { reason: sanitizeLogReason(reason) }),
    ...(detail === undefined ? {} : { detail: sanitizeLogReason(detail) }),
  });
}
