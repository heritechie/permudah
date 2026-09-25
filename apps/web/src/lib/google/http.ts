/**
 * Server-side transport for Google HTTP APIs.
 *
 * All Google API calls share one concern set: attach the Bearer token, send
 * JSON, decode the documented error envelope, and normalize failures into
 * GoogleError. This module is the only place the raw fetch for Google APIs
 * lives, which keeps secret handling in one spot.
 *
 * Secrets policy: the access token is only ever placed in the Authorization
 * header. Error messages never include request bodies or response bodies that
 * could contain token material.
 */

import { GoogleError, googleErrorCodeForKind, kindFromHttpStatus } from "@/lib/google/errors";
import { logGoogleApiFailure } from "@/lib/google/logging";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Stable, non-sensitive label for the Google operation being performed.
 *
 * Callers pass this explicitly so a failure can be traced to a step in the
 * provisioning sequence. It is a constant chosen at the call site: it can never
 * contain a token, an email, or a resource id.
 */
export type GoogleOperation =
  | "drive.files.create"
  | "drive.files.get"
  | "drive.files.delete"
  | "script.projects.create"
  | "script.projects.get"
  | "script.projects.updateContent"
  | "script.projects.versions.create"
  | "script.projects.deployments.create";

export type GoogleJsonRequest = {
  url: string;
  accessToken: string;
  operation: GoogleOperation;
  /** Request-scoped id that ties this call to the provisioning run. */
  correlationId: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
};

/**
 * Perform an authenticated Google API request and return the parsed JSON
 * response body. Throws GoogleError for any non-2xx response.
 */
export async function googleJsonRequest<T>(
  fetchImpl: FetchLike,
  request: GoogleJsonRequest,
): Promise<T> {
  const init: RequestInit = {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${request.accessToken}`,
      ...JSON_HEADERS,
    },
  };
  if (request.body !== undefined) {
    init.body = JSON.stringify(request.body);
  }

  const response = await fetchImpl(request.url, init);

  if (!response.ok) {
    const { message, codes } = await readGoogleError(response);
    const kind = kindFromHttpStatus(response.status, codes, message);
    // The actionable code, not Google's generic PERMISSION_DENIED status.
    const code = googleErrorCodeForKind(kind, codes);
    // Sanitized: operation, status, Google error code, truncated message.
    // The access token, the request body, and the raw response are never logged.
    logGoogleApiFailure({
      correlationId: request.correlationId,
      operation: request.operation,
      status: response.status,
      googleCode: code,
      reason: message,
    });
    throw new GoogleError(kind, message, response.status, code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new GoogleError(
      "google_api_error",
      "Google returned a non-JSON response.",
      response.status,
    );
  }
}

/**
 * Read the Google error envelope: `{ "error": { "code", "message", "errors" } }`
 * or the OAuth token endpoint shape `{ "error", "error_description" }`.
 * Never return the raw body because some endpoints echo request data.
 *
 * Returns every machine-readable code Google reported, not just the first one.
 * This matters for configuration failures: Google answers those with
 * `status: "PERMISSION_DENIED"` plus `errors[0].reason: "SERVICE_DISABLED"`,
 * so a single-code reader would miss the actionable reason.
 */
async function readGoogleError(
  response: Response,
): Promise<{ message: string; codes: string[] }> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    return { message: `Google request failed (HTTP ${response.status}).`, codes: [] };
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const errorShape = record.error;
    if (errorShape && typeof errorShape === "object") {
      const errorRecord = errorShape as Record<string, unknown>;
      const message =
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : `Google request failed (HTTP ${response.status}).`;
      return { message, codes: googleErrorCodes(errorRecord) };
    }
    if (typeof errorShape === "string") {
      const code = errorShape as string;
      const description =
        typeof record.error_description === "string" ? record.error_description : null;
      return {
        message: description ?? `Google OAuth request failed (${code}).`,
        codes: [code],
      };
    }
  }

  return { message: `Google request failed (HTTP ${response.status}).`, codes: [] };
}

/**
 * Collect every machine-readable identifier from a Google error envelope:
 * `status`, every `errors[].reason`, and the numeric `code`.
 */
function googleErrorCodes(errorRecord: Record<string, unknown>): string[] {
  const codes: string[] = [];
  if (typeof errorRecord.status === "string") codes.push(errorRecord.status);
  const errors = errorRecord.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (entry && typeof entry === "object") {
        const reason = (entry as Record<string, unknown>).reason;
        if (typeof reason === "string" && !codes.includes(reason)) codes.push(reason);
      }
    }
  }
  if (typeof errorRecord.code === "string" && !codes.includes(errorRecord.code)) {
    codes.push(errorRecord.code);
  }
  if (typeof errorRecord.code === "number" && !codes.includes(String(errorRecord.code))) {
    codes.push(String(errorRecord.code));
  }
  return codes;
}
