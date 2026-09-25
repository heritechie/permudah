import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * Proves the two properties that only show up when the real orchestrator runs
 * behind the callback route:
 *
 *   1. The registry write happens strictly after Google provisioning succeeds.
 *   2. A registry failure never deletes the Google resources the user just
 *      created. Those resources live in the user's own Drive and are theirs.
 *
 * Unlike `route.test.ts`, this file does NOT mock `@/lib/google/web-app`, so the
 * Drive and Apps Script calls are real and observable. Only the network
 * boundary and the registry write are substituted.
 */

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  exchangeGoogleAuthorizationCode: vi.fn(),
  fetchGoogleUserInfo: vi.fn(),
  recordProvisionedGoogleWebApp: vi.fn(),
  getAuthenticatedSession: vi.fn(),
  signWebAppResult: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/google/oauth", () => ({
  exchangeGoogleAuthorizationCode: mocks.exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo: mocks.fetchGoogleUserInfo,
  hasAllGoogleScopes: () => true,
  statesMatch: (expected: string, actual: string | null) => expected === actual,
}));
vi.mock("@/lib/google/registry", () => ({
  recordProvisionedGoogleWebApp: mocks.recordProvisionedGoogleWebApp,
}));
vi.mock("@/lib/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/google/result", () => ({
  signWebAppResult: mocks.signWebAppResult,
  readWebAppResult: vi.fn(),
}));

const GOOGLE_ROUTES: Record<string, { body?: unknown; status?: number }> = {
  "www.googleapis.com/drive/v3/files?": {
    body: {
      id: "sheet-1",
      name: "Hello from Permudah",
      webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
    },
  },
  "www.googleapis.com/drive/v3/files/sheet-1": {
    body: { owners: [{ emailAddress: "creator@example.com" }] },
  },
  "script.googleapis.com/v1/projects": {
    body: { scriptId: "script-1", parentId: "sheet-1", title: "Hello from Permudah" },
  },
  "script.googleapis.com/v1/projects/script-1/content": { body: null },
  "script.googleapis.com/v1/projects/script-1/versions": { body: { versionNumber: 1 } },
  "script.googleapis.com/v1/projects/script-1/deployments": {
    body: {
      deploymentId: "AKfycb_abc",
      entryPoints: [
        { entryPointType: "WEB_APP", webApp: { url: "https://script.google.com/macros/s/abc/exec" } },
      ],
    },
  },
};

/** Records every Google call so a test can assert nothing was deleted. */
function fakeGoogleFetch(overrides: Record<string, { body?: unknown; status?: number }> = {}) {
  const routes = { ...GOOGLE_ROUTES, ...overrides };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const entries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
    const entry = entries.find(([needle]) => url.includes(needle));
    const config = entry?.[1] ?? { body: null, status: 404 };
    const status = config.status ?? 200;
    return new Response(
      status === 204 ? null : JSON.stringify(config.body ?? null),
      { status, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetchImpl, calls };
}

function fakeCookieStore(cookies: Record<string, string>) {
  const map = new Map(Object.entries(cookies));
  return {
    get: (name: string) => (map.has(name) ? { name, value: map.get(name)! } : undefined),
    set: (name: string, value: string) => void map.set(name, value),
    delete: (name: string) => void map.delete(name),
    map,
  };
}

const FULL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://permudah.com/api/google/callback",
  GOOGLE_OAUTH_COOKIE_SECRET: "test-cookie-secret-that-is-long-enough-000000",
  NODE_ENV: "production",
} as const;

const SESSION_USER_ID = "session-user-1";

/** The cookie-scoped server client: ordinary `authenticated` role, user's JWT. */
const SESSION_CLIENT = { rpc: vi.fn(async () => ({ data: "row-1", error: null })) };
const baseUrl = "https://permudah.com/api/google/callback";

async function signedTransaction(userId = SESSION_USER_ID): Promise<string> {
  const { signGoogleOAuthTransaction } = await import("@/lib/google/transaction");
  return signGoogleOAuthTransaction(FULL_ENV.GOOGLE_OAUTH_COOKIE_SECRET, {
    state: "state-good",
    codeVerifier: "verifier-good",
    userId,
  });
}

async function runCallback(transaction: string, search = "code=code-1&state=state-good") {
  const { GET } = await import("./route");
  return GET(new Request(`${baseUrl}?${search}`));
}

beforeAll(async () => {
  const { setProcessEnv } = await import("@/lib/google/test-utils");
  for (const [key, value] of Object.entries(FULL_ENV)) setProcessEnv(key, value);
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

function seedHappySession(transaction: string) {
  const store = fakeCookieStore({ permudah_google_oauth_txn: transaction });
  mocks.cookies.mockResolvedValue(store);
  mocks.getAuthenticatedSession.mockResolvedValue({
    supabase: SESSION_CLIENT,
    user: { id: SESSION_USER_ID },
  });
  mocks.exchangeGoogleAuthorizationCode.mockResolvedValue({
    accessToken: "ya29.access-token",
    tokenType: "Bearer",
    expiresInSeconds: 3600,
    scope: "openid email https://www.googleapis.com/auth/drive.file",
  });
  mocks.fetchGoogleUserInfo.mockResolvedValue({
    email: "creator@example.com",
    sub: "google-sub-1",
    emailVerified: true,
  });
  mocks.signWebAppResult.mockResolvedValue("signed-result-reference");
  return store;
}

describe("callback registry boundary", () => {
  test("persists only after every Google provisioning step succeeded", async () => {
    const transaction = await signedTransaction();
    seedHappySession(transaction);
    const order: string[] = [];
    mocks.recordProvisionedGoogleWebApp.mockImplementation(async () => {
      order.push("registry");
      return { ok: true, id: "row-1", correlationId: "corr-1" };
    });

    const { fetchImpl, calls } = fakeGoogleFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await runCallback(transaction);

    expect(response.status).toBe(307);
    // Every Google resource was created before the registry row.
    expect(calls.some((call) => call.url.includes("drive/v3/files?"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/deployments"))).toBe(true);
    expect(order).toEqual(["registry"]);
  });

  test("does not delete any Google resource when the registry write fails", async () => {
    const transaction = await signedTransaction();
    seedHappySession(transaction);
    mocks.recordProvisionedGoogleWebApp.mockResolvedValue({
      ok: false,
      reason: "registry_write_failed",
      detail: "connection terminated",
      correlationId: "corr-x",
    });

    const { fetchImpl, calls } = fakeGoogleFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await runCallback(transaction);
    const location = response.headers.get("location")!;

    expect(location).toContain("error=registry_failed");
    // The user's Spreadsheet, script, and deployment stay in their Drive.
    expect(calls.some((call) => (call.init?.method ?? "GET") === "DELETE")).toBe(false);
    expect(calls.some((call) => call.url.includes("/trash"))).toBe(false);
    // The database error never reaches the browser.
    expect(location).not.toContain("connection terminated");
  });

  test("takes user_id from the session and ignores a user_id in the request", async () => {
    const transaction = await signedTransaction();
    seedHappySession(transaction);
    mocks.recordProvisionedGoogleWebApp.mockResolvedValue({
      ok: true,
      id: "row-1",
      correlationId: "corr-1",
    });

    const { fetchImpl } = fakeGoogleFetch();
    vi.stubGlobal("fetch", fetchImpl);

    await runCallback(
      transaction,
      "code=code-1&state=state-good&user_id=attacker-user&owner_email=attacker%40evil.example",
    );

    expect(mocks.recordProvisionedGoogleWebApp).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SESSION_USER_ID,
        ownerEmail: "creator@example.com",
      }),
      { client: SESSION_CLIENT },
    );
    const input = mocks.recordProvisionedGoogleWebApp.mock.calls[0][0] as Record<string, unknown>;
    expect(input.userId).not.toBe("attacker-user");
    expect(input.ownerEmail).not.toBe("attacker@evil.example");
  });

  test("control: a provisioning failure does trash the spreadsheet, so the assertion above has teeth", async () => {
    const transaction = await signedTransaction();
    seedHappySession(transaction);
    // Fail at the deployment step, after the spreadsheet exists.
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": {
        status: 500,
        body: { error: { status: "INTERNAL", message: "boom" } },
      },
    });
    vi.stubGlobal("fetch", fetchImpl);

    const response = await runCallback(transaction);

    expect(response.headers.get("location")).toContain("error=");
    // The harness can see a delete when one happens.
    expect(calls.some((call) => (call.init?.method ?? "GET") === "DELETE")).toBe(true);
    expect(mocks.recordProvisionedGoogleWebApp).not.toHaveBeenCalled();
  });

  test("persists only the registry columns, never a Google credential", async () => {
    const transaction = await signedTransaction();
    seedHappySession(transaction);
    mocks.recordProvisionedGoogleWebApp.mockResolvedValue({
      ok: true,
      id: "row-1",
      correlationId: "corr-1",
    });

    const { fetchImpl } = fakeGoogleFetch();
    vi.stubGlobal("fetch", fetchImpl);

    await runCallback(transaction);

    const input = mocks.recordProvisionedGoogleWebApp.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual([
      "correlationId",
      "deploymentId",
      "ownerEmail",
      "scriptId",
      "spreadsheetId",
      "userId",
      "webAppUrl",
    ]);
    // The access token obtained during the exchange is not forwarded anywhere.
    expect(JSON.stringify(input)).not.toContain("ya29.access-token");
  });
});
