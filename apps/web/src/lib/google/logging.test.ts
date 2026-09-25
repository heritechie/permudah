import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCorrelationId,
  logGoogleApiFailure,
  logGoogleEvent,
  sanitizeLogReason,
} from "@/lib/google/logging";

function captureConsole() {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  return {
    errorSpy,
    infoSpy,
    lines: () => [...errorSpy.mock.calls, ...infoSpy.mock.calls].map((call) => String(call[0])),
    payload: () =>
      [...errorSpy.mock.calls, ...infoSpy.mock.calls]
        .map((call) => String(call[0]).replace("[google] ", ""))
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCorrelationId", () => {
  test("is url-safe and long enough to be unguessable", () => {
    const id = createCorrelationId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  test("is different on every call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createCorrelationId()));
    expect(ids.size).toBe(50);
  });
});

describe("sanitizeLogReason", () => {
  test("redacts access tokens", () => {
    expect(sanitizeLogReason("failed for ya29.a0AfB_byC-SECRET-value")).not.toContain("SECRET");
    expect(sanitizeLogReason("failed for ya29.a0AfB_byC-SECRET-value")).toContain("[redacted-token]");
  });

  test("redacts refresh tokens, auth codes, client secrets and bearer headers", () => {
    expect(sanitizeLogReason("1//0eXaMpLeReFrEsHtOkEn0000000000000")).toContain("[redacted-refresh-token]");
    expect(sanitizeLogReason("code 4/0eXaMpLeAuThOrIzAtIoN000000")).toContain("[redacted-auth-code]");
    expect(sanitizeLogReason("secret GOCSPX-abc123XYZ")).toContain("[redacted-client-secret]");
    expect(sanitizeLogReason("Bearer ya29.tok")).not.toContain("ya29.tok");
  });

  test("redacts user emails", () => {
    expect(sanitizeLogReason("owner creator@example.com mismatched")).toContain("[redacted-email]");
  });

  test("keeps the actionable part of a Google message and caps its length", () => {
    const message =
      "Google Apps Script API has not been used in project 887739439651 before or it is disabled.";
    expect(sanitizeLogReason(message)).toContain("887739439651");
    expect(sanitizeLogReason("x".repeat(1000))).toMatch(/\.\.\.\[truncated\]$/);
    expect(sanitizeLogReason("x".repeat(1000)).length).toBeLessThanOrEqual(320);
  });

  test("handles missing values", () => {
    expect(sanitizeLogReason(null)).toBe("");
    expect(sanitizeLogReason(undefined)).toBe("");
  });
});

describe("logGoogleApiFailure", () => {
  test("logs operation, status, google code, correlation id and a sanitized reason", () => {
    const logs = captureConsole();

    logGoogleApiFailure({
      correlationId: "corr-123",
      operation: "script.projects.create",
      status: 403,
      googleCode: "SERVICE_DISABLED",
      reason: "Apps Script API has not been used in project 887739439651 before or it is disabled.",
    });

    const [entry] = logs.payload();
    expect(entry).toMatchObject({
      level: "error",
      event: "google_api_failure",
      correlationId: "corr-123",
      operation: "script.projects.create",
      status: 403,
      googleCode: "SERVICE_DISABLED",
    });
    expect(String(entry.reason)).toContain("887739439651");
  });

  test("never emits a token even when one reaches the reason", () => {
    const logs = captureConsole();

    logGoogleApiFailure({
      correlationId: "corr-123",
      operation: "drive.files.create",
      status: 401,
      googleCode: null,
      reason: "rejected ya29.SUPER-SECRET-ACCESS-TOKEN",
    });

    expect(logs.lines().join("\n")).not.toContain("SUPER-SECRET-ACCESS-TOKEN");
  });
});

describe("logGoogleEvent", () => {
  test("emits a single structured line with the correlation id", () => {
    const logs = captureConsole();

    logGoogleEvent({
      correlationId: "corr-456",
      event: "google_provisioning_failed",
      level: "error",
      reason: "forbidden",
      detail: "nope",
      spreadsheetId: "sheet-1",
    });

    const [entry] = logs.payload();
    expect(entry).toMatchObject({
      level: "error",
      event: "google_provisioning_failed",
      correlationId: "corr-456",
      reason: "forbidden",
      detail: "nope",
      spreadsheetId: "sheet-1",
    });
  });

  test("drops a field that is not on the allow-list", () => {
    const logs = captureConsole();

    // Cast: the allow-list must hold even against an untyped caller.
    logGoogleEvent({
      correlationId: "corr-456",
      event: "google_provisioning_failed",
      rawResponseBody: "access_token: ya29.leaked",
    } as unknown as Parameters<typeof logGoogleEvent>[0]);

    expect(logs.lines().join("\n")).not.toContain("rawResponseBody");
    expect(logs.lines().join("\n")).not.toContain("ya29.leaked");
  });

  test("scrubs an identifier that somehow contains a token", () => {
    const logs = captureConsole();

    logGoogleEvent({
      correlationId: "corr-456",
      event: "google_registry_recorded",
      spreadsheetId: "ya29.SHOULD-NEVER-APPEAR",
    });

    const [entry] = logs.payload();
    expect(entry.spreadsheetId).toBe("[redacted-token]");
  });

  test("omits reason and detail when they are not provided", () => {
    const logs = captureConsole();

    logGoogleEvent({ correlationId: "corr-789", event: "google_registry_recorded" });

    const [entry] = logs.payload();
    expect(entry).not.toHaveProperty("reason");
    expect(entry).not.toHaveProperty("detail");
  });
});
