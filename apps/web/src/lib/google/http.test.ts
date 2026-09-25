import { afterEach, describe, expect, test, vi } from "vitest";
import { GoogleError } from "@/lib/google/errors";
import { googleJsonRequest, type FetchLike } from "@/lib/google/http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

const REQUEST = {
  url: "https://script.googleapis.com/v1/projects",
  accessToken: "token-ok",
  operation: "script.projects.create" as const,
  correlationId: "corr-123",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("googleJsonRequest", () => {
  test("sends the token in the Authorization header only", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push([url, init]);
      return jsonResponse(200, { scriptId: "script-1" });
    };

    await googleJsonRequest(fetchImpl, { ...REQUEST, body: { title: "App" } });

    const [url, init] = calls[0];
    expect(url).toBe(REQUEST.url);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-ok");
    expect(init?.body).toBe(JSON.stringify({ title: "App" }));
  });

  test("logs the actionable code and correlation id for a disabled API", async () => {
    const logs = captureConsole();
    const fetchImpl: FetchLike = async () =>
      jsonResponse(403, {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          message:
            "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
          errors: [{ reason: "SERVICE_DISABLED", domain: "googleapis.com" }],
        },
      });

    const error = await googleJsonRequest(fetchImpl, REQUEST).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GoogleError);
    expect((error as GoogleError).kind).toBe("service_disabled");
    // The actionable reason, not the generic PERMISSION_DENIED status.
    expect((error as GoogleError).code).toBe("SERVICE_DISABLED");

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

  test("never writes the access token to the log", async () => {
    const logs = captureConsole();
    const fetchImpl: FetchLike = async () =>
      jsonResponse(401, { error: { status: "UNAUTHENTICATED", message: "Invalid Credentials" } });

    await googleJsonRequest(fetchImpl, REQUEST).catch(() => undefined);

    expect(logs.lines().join("\n")).not.toContain("token-ok");
  });

  test("reports a plain permission denial as forbidden", async () => {
    captureConsole();
    const fetchImpl: FetchLike = async () =>
      jsonResponse(403, { error: { status: "PERMISSION_DENIED", message: "Insufficient permissions." } });

    const error = (await googleJsonRequest(fetchImpl, REQUEST).catch((e: unknown) => e)) as GoogleError;

    expect(error.kind).toBe("forbidden");
    expect(error.code).toBe("PERMISSION_DENIED");
  });

  test("decodes the OAuth error shape", async () => {
    captureConsole();
    const fetchImpl: FetchLike = async () =>
      jsonResponse(400, { error: "invalid_grant", error_description: "Bad authorization code." });

    const error = (await googleJsonRequest(fetchImpl, REQUEST).catch((e: unknown) => e)) as GoogleError;

    expect(error.kind).toBe("invalid_grant");
    expect(error.code).toBe("invalid_grant");
  });

  test("handles a non-JSON error body without throwing a parse error", async () => {
    const logs = captureConsole();
    const fetchImpl: FetchLike = async () =>
      new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } });

    const error = (await googleJsonRequest(fetchImpl, REQUEST).catch((e: unknown) => e)) as GoogleError;

    expect(error).toBeInstanceOf(GoogleError);
    expect(error.status).toBe(502);
    expect(logs.payload()).toHaveLength(1);
  });

  test("reports a non-JSON success body as a Google API error", async () => {
    captureConsole();
    const fetchImpl: FetchLike = async () =>
      new Response("not json", { status: 200, headers: { "Content-Type": "text/html" } });

    const error = (await googleJsonRequest(fetchImpl, REQUEST).catch((e: unknown) => e)) as GoogleError;

    expect(error).toBeInstanceOf(GoogleError);
    expect(error.kind).toBe("google_api_error");
  });

  test("returns undefined for a 204 response", async () => {
    const fetchImpl: FetchLike = async () => new Response(null, { status: 204 });

    await expect(googleJsonRequest(fetchImpl, { ...REQUEST, method: "DELETE" })).resolves.toBeUndefined();
  });
});
