import { describe, expect, test } from "vitest";
import {
  GoogleError,
  extractGoogleProjectNumber,
  googleErrorCodeForKind,
  kindFromHttpStatus,
} from "@/lib/google/errors";

describe("kindFromHttpStatus", () => {
  test("maps authentication failures", () => {
    expect(kindFromHttpStatus(401)).toBe("unauthorized");
  });

  test("maps authorization failures", () => {
    expect(kindFromHttpStatus(403)).toBe("forbidden");
    expect(kindFromHttpStatus(403, "PERMISSION_DENIED")).toBe("forbidden");
  });

  test("detects insufficient scope from code, reason, and message", () => {
    expect(kindFromHttpStatus(403, "insufficientPermissions")).toBe("insufficient_scope");
    expect(kindFromHttpStatus(403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT")).toBe("insufficient_scope");
    expect(
      kindFromHttpStatus(403, null, "Request had insufficient authentication scopes."),
    ).toBe("insufficient_scope");
  });

  test("maps other http statuses", () => {
    expect(kindFromHttpStatus(404)).toBe("not_found");
    expect(kindFromHttpStatus(429)).toBe("rate_limited");
    expect(kindFromHttpStatus(500)).toBe("google_api_error");
    expect(kindFromHttpStatus(400, "invalid_grant")).toBe("invalid_grant");
  });

  test("maps a disabled Google API to service_disabled, not a user permission problem", () => {
    // The real Apps Script response: status is PERMISSION_DENIED and the
    // actionable reason only appears in errors[].reason.
    expect(
      kindFromHttpStatus(403, ["PERMISSION_DENIED", "SERVICE_DISABLED", "403"]),
    ).toBe("service_disabled");

    // The Drive variant reports ACCESS_NOT_CONFIGURED.
    expect(kindFromHttpStatus(403, ["PERMISSION_DENIED", "ACCESS_NOT_CONFIGURED"])).toBe(
      "service_disabled",
    );

    // A single reported code still works.
    expect(kindFromHttpStatus(403, "SERVICE_DISABLED")).toBe("service_disabled");
  });

  test("still maps a plain permission denial to forbidden", () => {
    expect(kindFromHttpStatus(403, ["PERMISSION_DENIED"])).toBe("forbidden");
  });

  test("falls back to the message when no code identifies a disabled API", () => {
    expect(
      kindFromHttpStatus(
        403,
        [],
        "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
      ),
    ).toBe("service_disabled");
  });

  test("prefers the more specific scope diagnosis over service_disabled", () => {
    expect(
      kindFromHttpStatus(403, ["PERMISSION_DENIED", "SERVICE_DISABLED", "insufficientPermissions"]),
    ).toBe("insufficient_scope");
  });
});

describe("extractGoogleProjectNumber", () => {
  test("extracts the project number Google names in a disabled-API message", () => {
    expect(
      extractGoogleProjectNumber(
        "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
      ),
    ).toBe("887739439651");
  });

  test("returns null when Google did not name a project", () => {
    expect(extractGoogleProjectNumber("Insufficient permissions.")).toBeNull();
    expect(extractGoogleProjectNumber(null)).toBeNull();
    expect(extractGoogleProjectNumber(undefined)).toBeNull();
  });

  test("never returns anything that is not a bare number", () => {
    // A bare "project <digits>" outside Google's canonical phrasing is not
    // trusted, so hostile message text cannot produce a project id.
    expect(extractGoogleProjectNumber("project 123456<script>alert(1)</script>")).toBeNull();
    expect(extractGoogleProjectNumber("project abc123456")).toBeNull();
    expect(extractGoogleProjectNumber("project 12")).toBeNull();
    expect(extractGoogleProjectNumber("used in project 123456abc")).toBeNull();
  });

  test("reads the project number from the console link Google includes", () => {
    expect(
      extractGoogleProjectNumber(
        "Enable it by visiting https://console.developers.google.com/apis/api/script.googleapis.com/overview?project=887739439651 then retry.",
      ),
    ).toBe("887739439651");
  });
});

describe("googleErrorCodeForKind", () => {
  test("reports the actionable reason, not the generic status", () => {
    expect(
      googleErrorCodeForKind("service_disabled", ["PERMISSION_DENIED", "SERVICE_DISABLED", "403"]),
    ).toBe("SERVICE_DISABLED");
    expect(
      googleErrorCodeForKind("service_disabled", ["PERMISSION_DENIED", "ACCESS_NOT_CONFIGURED"]),
    ).toBe("ACCESS_NOT_CONFIGURED");
    expect(
      googleErrorCodeForKind("insufficient_scope", ["PERMISSION_DENIED", "insufficientPermissions"]),
    ).toBe("insufficientPermissions");
  });

  test("matches a reported code regardless of case", () => {
    expect(googleErrorCodeForKind("service_disabled", ["PERMISSION_DENIED", "service_disabled"])).toBe(
      "service_disabled",
    );
  });

  test("falls back to the first code Google sent for a generic failure", () => {
    expect(googleErrorCodeForKind("forbidden", ["PERMISSION_DENIED"])).toBe("PERMISSION_DENIED");
    expect(googleErrorCodeForKind("google_api_error", ["BACKEND_ERROR"])).toBe("BACKEND_ERROR");
  });

  test("returns null when Google reported no code", () => {
    expect(googleErrorCodeForKind("service_disabled", [])).toBeNull();
  });
});

describe("GoogleError", () => {
  test("carries a stable kind and status", () => {
    const error = new GoogleError("unauthorized", "expired", 401);
    expect(error.name).toBe("GoogleError");
    expect(error.kind).toBe("unauthorized");
    expect(error.status).toBe(401);
    expect(error.code).toBeNull();
  });

  test("carries the Google error code when one was reported", () => {
    const error = new GoogleError("service_disabled", "api is disabled", 403, "SERVICE_DISABLED");
    expect(error.kind).toBe("service_disabled");
    expect(error.status).toBe(403);
    expect(error.code).toBe("SERVICE_DISABLED");
  });
});

