/**
 * Google integration error normalization.
 *
 * Every failure that crosses the Google domain boundary is surfaced as a
 * GoogleError with a stable `kind`. Code that renders network/security errors
 * must switch on `kind`, never on raw response text.
 */

export type GoogleErrorKind =
  /** The credentials are missing, expired, or invalid (HTTP 401). */
  | "unauthorized"
  /** The authorized identity cannot perform the action (HTTP 403). */
  | "forbidden"
  /**
   * The Google Cloud project behind this OAuth client does not have the API
   * enabled. This is a deployment/configuration fault, not a user permission
   * problem, and it is actionable because the project id can be reported.
   *
   * This is an *operator* fault. The end user cannot fix it, and telling them
   * to change anything in Google Cloud would be wrong.
   */
  | "service_disabled"
  /**
   * The authorized Google account has not granted third-party applications
   * access to its Apps Script projects. This is a per-user setting the user
   * completes once at https://script.google.com/home/usersettings, and it is
   * distinct from the Cloud-project API being disabled.
   */
  | "apps_script_access_required"
  /** Requested/returned scope set no longer covers the operation. */
  | "insufficient_scope"
  /** OAuth token exchange rejected (invalid grant / bad code). */
  | "invalid_grant"
  /** The resource or API path does not exist (HTTP 404). */
  | "not_found"
  /** Google rate-limited the call (HTTP 429). */
  | "rate_limited"
  /** The Web App deployment existed but no executable URL was returned. */
  | "missing_web_app_url"
  /** Any other Google-reachable error (HTTP >= 400, transport, etc.). */
  | "google_api_error";

export class GoogleError extends Error {
  readonly kind: GoogleErrorKind;
  readonly status: number | null;
  /** The most specific machine-readable code Google reported, when any. */
  readonly code: string | null;

  constructor(
    kind: GoogleErrorKind,
    message: string,
    status: number | null = null,
    code: string | null = null,
  ) {
    super(message);
    this.name = "GoogleError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Google error codes that mean "this API is not enabled on the project". */
export const GOOGLE_SERVICE_DISABLED_CODES = ["SERVICE_DISABLED", "ACCESS_NOT_CONFIGURED"] as const;

/**
 * Where a Google user grants third-party applications access to their Apps
 * Script projects. It is a per-account setting, separate from enabling an API on
 * a Cloud project.
 */
export const APPS_SCRIPT_USER_SETTINGS_URL = "https://script.google.com/home/usersettings";

/**
 * Google reports "the user has not enabled the Apps Script API" as a 403 whose
 * `status` is `PERMISSION_DENIED` and whose `errors[0].reason` is the useless
 * `forbidden`, with the real cause only in the message:
 *
 *   "User has not enabled the Apps Script API. Enable it by visiting
 *    https://script.google.com/home/usersettings then retry."
 *
 * The match is anchored to that one canonical sentence or to the settings URL,
 * so ordinary 403s are not swept into this state. Only the boolean outcome is
 * ever used; the message itself stays server-side.
 */
function mentionsAppsScriptUserGrant(message: string | null | undefined): boolean {
  if (typeof message !== "string") return false;
  return (
    /user has not enabled the apps script api/i.test(message) ||
    message.includes(APPS_SCRIPT_USER_SETTINGS_URL)
  );
}

function toCodeList(googleCode: string | readonly string[] | null | undefined): string[] {
  if (!googleCode) return [];
  return typeof googleCode === "string" ? [googleCode] : [...googleCode];
}

/**
 * Derive the normalized error kind from an HTTP status and, when available, the
 * Google error code returned in the response body.
 */
export function kindFromHttpStatus(
  status: number,
  googleCode?: string | readonly string[] | null,
  message?: string | null,
): GoogleErrorKind {
  const codes = toCodeList(googleCode);
  const has = (candidate: string) => codes.includes(candidate);

  if (
    has("insufficient_scope") ||
    has("insufficientPermissions") ||
    has("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
  ) {
    return "insufficient_scope";
  }
  if (has("invalid_grant")) {
    return "invalid_grant";
  }
  if (GOOGLE_SERVICE_DISABLED_CODES.some((code) => has(code))) {
    return "service_disabled";
  }
  // Checked after the explicit codes so a Cloud-project misconfiguration always
  // wins: it is the deeper fault, and a user cannot fix it by granting access.
  if (status === 403 && mentionsAppsScriptUserGrant(message)) {
    return "apps_script_access_required";
  }
  if (message && /insufficient.*scope/i.test(message)) {
    return "insufficient_scope";
  }
  if (message && /api has not been used in project|is disabled/i.test(message)) {
    return "service_disabled";
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "google_api_error";
}

/**
 * Google error codes that explain *why* a call failed, in the order they are
 * preferred for reporting. A configuration failure is reported by Google as
 * `status: "PERMISSION_DENIED"` plus `errors[0].reason: "SERVICE_DISABLED"`, so
 * the first code is the least useful one. The code stored on the error and
 * written to the log is the actionable reason, not the generic status.
 */
const ACTIONABLE_CODES: Partial<Record<GoogleErrorKind, string[]>> = {
  service_disabled: ["SERVICE_DISABLED", "ACCESS_NOT_CONFIGURED"],
  apps_script_access_required: ["forbidden", "PERMISSION_DENIED"],
  insufficient_scope: ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"],
  invalid_grant: ["invalid_grant", "INVALID_GRANT"],
  unauthorized: ["UNAUTHENTICATED", "invalid_token", "INVALID_TOKEN"],
  forbidden: ["PERMISSION_DENIED", "forbidden", "FORBIDDEN"],
  not_found: ["NOT_FOUND", "notFound"],
  rate_limited: ["RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "RESOURCE_EXHAUSTED"],
  missing_web_app_url: ["NO_WEB_APP_URL", "invalid_deployment"],
};

/**
 * Pick the most actionable code Google reported for a failure.
 *
 * Returns the first code that actually explains the diagnosis, falling back to
 * the first code Google sent, or null when Google sent none.
 */
export function googleErrorCodeForKind(
  kind: GoogleErrorKind,
  codes: readonly string[],
): string | null {
  for (const preferred of ACTIONABLE_CODES[kind] ?? []) {
    const found = codes.find((code) => code.toLowerCase() === preferred.toLowerCase());
    if (found) return found;
  }
  return codes[0] ?? null;
}

/**
 * Google reports a disabled API as "Google Apps Script API has not been used in
 * project 887739439651 before or it is disabled" and links to
 * ".../overview?project=887739439651". A project number is a public identifier,
 * not a credential, so it is safe to show a user.
 *
 * The match is anchored to those two canonical shapes on purpose: it will not
 * report a project number scraped out of arbitrary message text, and the
 * captured group is digits only, so nothing attacker-controlled can be
 * reflected into a page or a URL.
 */
export function extractGoogleProjectNumber(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const match = /(?:used in project\s+|project=)(\d{6,20})(?![0-9A-Za-z])/.exec(message);
  return match ? match[1] : null;
}