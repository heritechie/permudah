import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { GET } from "./route";
import { signGoogleOAuthTransaction } from "@/lib/google/transaction";
import { readWebAppResult } from "@/lib/google/result";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleError } from "@/lib/google/errors";
import { restoreProcessEnv, setProcessEnv, snapshotProcessEnv } from "@/lib/google/test-utils";

// Realistic token-response scope value: Google reports the API resource scopes
// and does not echo the openid/email identity scopes.
const SCOPE_STRING =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getAuthenticatedSession: vi.fn(),
}));

vi.mock("@/lib/google/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/oauth")>();
  return {
    ...actual,
    exchangeGoogleAuthorizationCode: vi.fn(),
    fetchGoogleUserInfo: vi.fn(),
  };
});

vi.mock("@/lib/google/web-app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/web-app")>();
  return { ...actual, createUserOwnedWebApp: vi.fn() };
});

vi.mock("@/lib/google/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/registry")>();
  return { ...actual, recordProvisionedGoogleWebApp: vi.fn() };
});

const { cookies } = await import("next/headers");
const { getAuthenticatedSession } = await import("@/lib/session");
const { exchangeGoogleAuthorizationCode, fetchGoogleUserInfo } = await import("@/lib/google/oauth");
const { createUserOwnedWebApp } = await import("@/lib/google/web-app");
const { recordProvisionedGoogleWebApp } = await import("@/lib/google/registry");

const COOKIE_SECRET = "test-cookie-secret-that-is-long-enough-1234";
const TXN_COOKIE = "permudah_google_oauth_txn";
const RESULT_COOKIE = "permudah_google_result";
const TTL_MS = 10 * 60 * 1000;

const GOOGLE_ENV_KEYS = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_COOKIE_SECRET",
  "NODE_ENV",
] as const;
const originalEnv = snapshotProcessEnv(GOOGLE_ENV_KEYS);

beforeAll(() => {
  for (const key of GOOGLE_ENV_KEYS) originalEnv.set(key, process.env[key]);
});

afterEach(() => {
  restoreProcessEnv(originalEnv);
  vi.clearAllMocks();
});

const FULL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_COOKIE_SECRET: COOKIE_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: "https://permudah.com/api/google/callback",
  NODE_ENV: "test",
};

function setEnv(overrides: Partial<Record<(typeof GOOGLE_ENV_KEYS)[number], string | undefined>>) {
  for (const key of GOOGLE_ENV_KEYS) {
    setProcessEnv(key, key in overrides ? overrides[key] : FULL_ENV[key]);
  }
}

function fakeCookieStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get: vi.fn((name: string) => (map.has(name) ? { name, value: map.get(name)! } : undefined)),
    set: vi.fn((name: string, value: string) => void map.set(name, value)),
    delete: vi.fn((name: string) => void map.delete(name)),
  };
}

async function transactionCookie(overrides: Partial<{ state: string; userId: string; codeVerifier: string }> = {}) {
  return signGoogleOAuthTransaction(COOKIE_SECRET, {
    state: "state-good",
    codeVerifier: "verifier-good",
    userId: "user-1",
    ...overrides,
  });
}

/** Stand-in for the cookie-scoped server client that carries the user's JWT. */
const SESSION_CLIENT = { rpc: vi.fn() } as unknown as SupabaseClient;

function mockSession(userId: string | null) {
  vi.mocked(getAuthenticatedSession).mockResolvedValue(
    userId ? ({ supabase: SESSION_CLIENT, user: { id: userId } }) : null,
  );
}

function happyFlow(cookieValue: string) {
  const store = fakeCookieStore({ [TXN_COOKIE]: cookieValue });
  vi.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  mockSession("user-1");
  vi.mocked(exchangeGoogleAuthorizationCode).mockResolvedValue({
    accessToken: "ya29.secret",
    tokenType: "Bearer",
    expiresInSeconds: 3600,
    scope: SCOPE_STRING,
  });
  vi.mocked(fetchGoogleUserInfo).mockResolvedValue({
    email: "creator@example.com",
    sub: "google-sub-1",
    emailVerified: true,
  });
  vi.mocked(createUserOwnedWebApp).mockResolvedValue({
    ok: true,
    data: {
      appName: "Hello from Permudah",
      ownerEmail: "creator@example.com",
      spreadsheetId: "sheet-1",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      scriptId: "script-1",
      deploymentId: "AKfycb_abc",
      webAppUrl: "https://script.google.com/macros/s/abc/exec",
    },
  });
  vi.mocked(recordProvisionedGoogleWebApp).mockResolvedValue({
    ok: true,
    id: "11111111-1111-1111-1111-111111111111",
    correlationId: "corr-1",
  });
  return store;
}

const baseUrl = "https://permudah.com/api/google/callback";

describe("GET /api/google/callback", () => {
  test("creates the user-owned resources and redirects to a token-free result page", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(location).toBe("https://permudah.com/google/result");
    expect(location).not.toContain("?");
    expect(location).not.toContain("ya29.secret");
    expect(location).not.toContain("creator@example.com");
    expect(await response.text()).not.toContain("ya29.secret");

    // The transaction cookie is cleared from the response.
    expect(store.map.has(TXN_COOKIE)).toBe(false);

    const resultCookie = store.map.get(RESULT_COOKIE);
    expect(resultCookie).toBeTruthy();
    expect(resultCookie).not.toContain("ya29.secret");
    const reference = await readWebAppResult(COOKIE_SECRET, resultCookie!, { ttlMs: TTL_MS });
    expect(reference).toMatchObject({
      userId: "user-1",
      ownerEmail: "creator@example.com",
      webAppUrl: "https://script.google.com/macros/s/abc/exec",
      spreadsheetId: "sheet-1",
    });
  });

  test("clears the transaction cookie on success so the browser drops it", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    // No token-bearing transaction survives the redirect. A retry must go back
    // through /api/google/auth, which mints new state, a new PKCE verifier, and a
    // new cookie; the authorization code is what Google enforces as single-use.
    expect(store.map.has(TXN_COOKIE)).toBe(false);
  });

  test("uses the configured redirect uri and the signed code verifier for the exchange", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(exchangeGoogleAuthorizationCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: "client-123",
        clientSecret: "client-secret",
        redirectUri: "https://permudah.com/api/google/callback",
        codeVerifier: "verifier-good",
        code: "code-1",
      }),
    );
  });

  test("rejects a transaction issued for a different Permudah user", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie({ userId: "someone-else" }));

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });

  test("rejects a forged or tampered transaction cookie", async () => {
    setEnv(FULL_ENV);
    const valid = await transactionCookie();
    const store = happyFlow(`${valid.slice(0, valid.indexOf("."))}.tampered-signature`);

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
    expect(store.map.has(TXN_COOKIE)).toBe(false);
  });

  test("rejects a state that does not match the signed transaction", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-evil`));

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });

  test("rejects an expired transaction", async () => {
    setEnv(FULL_ENV);
    const expired = await signGoogleOAuthTransaction(COOKIE_SECRET, {
      state: "state-good",
      codeVerifier: "verifier-good",
      userId: "user-1",
      now: Date.now() - TTL_MS - 1000,
    });
    happyFlow(expired);

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });

  test("requires a signed-in Permudah user", async () => {
    setEnv(FULL_ENV);
    const store = fakeCookieStore({ [TXN_COOKIE]: await transactionCookie() });
    vi.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
    mockSession(null);

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://permudah.com/login?redirect=%2Fgoogle");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });

  test("redirects with denied when the user declines consent", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?error=access_denied`));

    expect(response.headers.get("location")).toContain("error=denied");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
    expect(store.map.has(TXN_COOKIE)).toBe(false);
  });

  test("redirects with token_exchange_failed when the code is rejected", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(exchangeGoogleAuthorizationCode).mockRejectedValue(
      new GoogleError("invalid_grant", "Google OAuth token exchange failed.", 400),
    );

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = response.headers.get("location")!;
    expect(location).toContain("error=token_exchange_failed");
    expect(location).not.toContain("client-secret");
  });

  test("redirects with client_misconfigured when Google rejects the OAuth client", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(exchangeGoogleAuthorizationCode).mockRejectedValue(
      new GoogleError("forbidden", "Google OAuth token exchange failed.", 401),
    );

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=client_misconfigured");
  });

  test("redirects with insufficient_scope when an API scope is genuinely missing", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(exchangeGoogleAuthorizationCode).mockResolvedValue({
      accessToken: "ya29.secret",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
      scope:
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.projects",
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=insufficient_scope");
    expect(createUserOwnedWebApp).not.toHaveBeenCalled();
  });

  test("proceeds when Google omits the scope field (granted == requested)", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(exchangeGoogleAuthorizationCode).mockResolvedValue({
      accessToken: "ya29.secret",
      tokenType: "Bearer",
      expiresInSeconds: 3600,
      scope: "",
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toBe("https://permudah.com/google/result");
    expect(createUserOwnedWebApp).toHaveBeenCalled();
  });

  test("redirects with userinfo_failed when the account cannot be read", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(fetchGoogleUserInfo).mockRejectedValue(
      new GoogleError("unauthorized", "expired", 401),
    );

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=userinfo_failed");
    expect(createUserOwnedWebApp).not.toHaveBeenCalled();
  });

  test("refuses to provision when the Google email is not verified", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(fetchGoogleUserInfo).mockResolvedValue({
      email: "creator@example.com",
      sub: "google-sub-1",
      emailVerified: false,
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=unverified_email");
    expect(createUserOwnedWebApp).not.toHaveBeenCalled();
  });

  test("passes only the Google identity from the OAuth session to the orchestrator", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good&accountId=attacker-controlled`));

    expect(createUserOwnedWebApp).toHaveBeenCalledWith(
      expect.anything(),
      "ya29.secret",
      { appName: "Hello from Permudah", ownerEmail: "creator@example.com" },
      expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
    );
  });

  test("surfaces the provisioning failure reason without leaking the token", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "ownership_mismatch",
      message: "The created spreadsheet is not owned by the authenticated Google account.",
      correlationId: "corr-ownership",
      googleProjectNumber: null,
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = response.headers.get("location")!;
    expect(location).toContain("error=ownership_mismatch");
    expect(location).not.toContain("ya29.secret");
    expect(location).not.toContain("The created spreadsheet");
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });

  test("gives every early failure a support reference and a log line", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=attacker-state`));

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("invalid_state");
    expect(location.searchParams.get("ref")).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });

  test("logs why the state check failed without logging the code or cookie", async () => {
    setEnv(FULL_ENV);
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=attacker-state`));

    const logged = logs.join("\n");
    expect(logged).toContain("google_flow_rejected");
    expect(logged).toContain("state_present=true");
    // The authorization code and the signed cookie must not be logged.
    expect(logged).not.toContain("code-1");
    expect(logged).not.toContain("attacker-state");
  });

  test("logs a failed token exchange without logging the code, verifier, or secret", async () => {
    setEnv(FULL_ENV);
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    const store = happyFlow(await transactionCookie());
    vi.mocked(exchangeGoogleAuthorizationCode).mockRejectedValue(
      new GoogleError("google_api_error", "Bad authorization code. code=4/0eXaMpLeSeCrEtCoDe000000", 400),
    );

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=token_exchange_failed");
    const logged = logs.join("\n");
    expect(logged).toContain("google_flow_rejected");
    expect(logged).not.toContain("0eXaMpLeSeCrEtCoDe000000");
    expect(logged).not.toContain("client-secret");
    expect(logged).not.toContain("verifier-good");
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });

  test("fails closed when the signing secret is not configured", async () => {
    setEnv({ GOOGLE_OAUTH_COOKIE_SECRET: undefined });
    happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("error=missing_config");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });
  test("clears the transaction cookie before any validation outcome", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    // The cookie is deleted from the response, not merely read, so the browser
    // drops it. This is not a server-side single-use guard: there is no durable
    // consumed marker, so a replayed callback would be re-validated.
    expect(store.delete).toHaveBeenCalledWith(TXN_COOKIE);
    expect(store.map.has(TXN_COOKIE)).toBe(false);
  });

  test("clears the transaction cookie even when the state does not match", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=attacker-state`));

    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(store.delete).toHaveBeenCalledWith(TXN_COOKIE);
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });

  test("cannot exchange the code when the Permudah user is no longer signed in", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());
    mockSession(null);

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(response.headers.get("location")).toContain("/login");
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
    expect(createUserOwnedWebApp).not.toHaveBeenCalled();
    expect(recordProvisionedGoogleWebApp).not.toHaveBeenCalled();
    // The leftover transaction cookie is bound to a userId that a future session
    // must match, which limits who could present it again. It is not a
    // single-use guard in its own right; the code is what Google makes single-use.
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });

  test("records the install in the registry only after Google provisioning succeeds", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(recordProvisionedGoogleWebApp).toHaveBeenCalledTimes(1);
    expect(recordProvisionedGoogleWebApp).toHaveBeenCalledWith(
      {
        // The owner comes from the authenticated session, not from the request.
        userId: "user-1",
        spreadsheetId: "sheet-1",
        scriptId: "script-1",
        deploymentId: "AKfycb_abc",
        webAppUrl: "https://script.google.com/macros/s/abc/exec",
        ownerEmail: "creator@example.com",
        correlationId: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/),
      },
      // The write uses the caller's own session-scoped client, so the database
      // re-derives the owner from the JWT. No elevated credential is passed.
      { client: SESSION_CLIENT },
    );
    expect(store.map.get(RESULT_COOKIE)).toBeTruthy();
  });

  test("does not record anything when provisioning fails", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "forbidden",
      message: "Google rejected the call.",
      correlationId: "corr-forbidden",
      googleProjectNumber: null,
    });

    await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    expect(recordProvisionedGoogleWebApp).not.toHaveBeenCalled();
  });

  test("reports a registry failure without deleting the user's Google resources", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());
    vi.mocked(recordProvisionedGoogleWebApp).mockResolvedValue({
      ok: false,
      reason: "registry_not_configured",
      detail: "No authenticated database client was available for the registry write.",
      correlationId: "corr-registry",
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = response.headers.get("location")!;
    expect(location).toContain("error=registry_failed");
    expect(location).toContain("ref=");
    // No result page and no URLs: the user is told the app exists in their Drive.
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
    expect(location).not.toContain("ya29.secret");
    expect(location).not.toContain("script.google.com");
  });

  test("keeps the Google Cloud project number out of the error redirect", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "service_disabled",
      message: "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
      correlationId: "corr-service",
      googleProjectNumber: "887739439651",
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/google");
    expect(location.searchParams.get("error")).toBe("service_disabled");
    expect(location.searchParams.get("ref")).toBe("corr-service");

    // Permudah's own project number stays server-side, for the operator log
    // keyed by the same correlation id. It never reaches the browser.
    expect(location.searchParams.has("project")).toBe(false);
    const href = response.headers.get("location")!;
    expect(href).not.toContain("887739439651");
    expect(href).not.toContain("project");
    // The raw Google message never reaches the URL either.
    expect(href).not.toContain("has not been used");
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });

  test("ties the user's reference to a log line and sends no project detail", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "service_disabled",
      message: "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
      correlationId: "corr-service-log",
      googleProjectNumber: "887739439651",
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    // The correlation id is the only thing the user gets, and it is the key an
    // operator uses to find the sanitized log line holding the project number.
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("ref")).toBe("corr-service-log");
    expect(response.headers.get("location")).not.toContain("887739439651");
  });

  test("sends exactly error and ref on a provisioning failure redirect", async () => {
    setEnv(FULL_ENV);
    happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "service_disabled",
      message: "The API is disabled.",
      correlationId: "corr-service-2",
      googleProjectNumber: null,
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = new URL(response.headers.get("location")!);
    expect([...location.searchParams.keys()].sort()).toEqual(["error", "ref"]);
    expect(location.searchParams.get("error")).toBe("service_disabled");
    expect(location.searchParams.get("ref")).toBe("corr-service-2");
  });

  test("forwards apps_script_access_required as its own reason", async () => {
    setEnv(FULL_ENV);
    const store = happyFlow(await transactionCookie());
    vi.mocked(createUserOwnedWebApp).mockResolvedValue({
      ok: false,
      reason: "apps_script_access_required",
      message:
        "User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.",
      correlationId: "corr-user-grant",
      googleProjectNumber: null,
    });

    const response = await GET(new Request(`${baseUrl}?code=code-1&state=state-good`));

    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/google");
    expect(location.searchParams.get("error")).toBe("apps_script_access_required");
    expect(location.searchParams.get("ref")).toBe("corr-user-grant");
    // The raw Google message never reaches the URL.
    const href = response.headers.get("location")!;
    expect(href).not.toContain("has not been enabled");
    expect(href).not.toContain("script.google.com");
    expect(href).not.toContain("User%20has%20not");
    expect(store.map.has(RESULT_COOKIE)).toBe(false);
  });
});
