import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { GET } from "./route";
import { readGoogleOAuthTransaction } from "@/lib/google/transaction";
import { restoreProcessEnv, setProcessEnv, snapshotProcessEnv } from "@/lib/google/test-utils";

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
    buildGoogleAuthorizationUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=state-abc"),
  };
});

const { cookies } = await import("next/headers");
const { getAuthenticatedSession } = await import("@/lib/session");
const { buildGoogleAuthorizationUrl } = await import("@/lib/google/oauth");

const COOKIE_SECRET = "test-cookie-secret-that-is-long-enough-1234";
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

function setEnv(overrides: Partial<Record<(typeof GOOGLE_ENV_KEYS)[number], string | undefined>>) {
  for (const key of GOOGLE_ENV_KEYS) setProcessEnv(key, overrides[key]);
}

function fakeCookieStore() {
  const map = new Map<string, string>();
  return {
    map,
    get: vi.fn((name: string) => (map.has(name) ? { name, value: map.get(name)! } : undefined)),
    set: vi.fn((name: string, value: string) => void map.set(name, value)),
    delete: vi.fn((name: string) => void map.delete(name)),
  };
}

function setup({ userId = "user-1" }: { userId?: string | null } = {}) {
  const store = fakeCookieStore();
  vi.mocked(cookies).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(getAuthenticatedSession).mockResolvedValue(
    userId ? ({ supabase: {} as never, user: { id: userId } }) : null,
  );
  return store;
}

const FULL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_COOKIE_SECRET: COOKIE_SECRET,
  GOOGLE_OAUTH_REDIRECT_URI: "https://permudah.com/api/google/callback",
};

describe("GET /api/google/auth", () => {
  test("redirects a signed-in user to Google with a signed, user-bound transaction cookie", async () => {
    setEnv({ ...FULL_ENV, NODE_ENV: "test" });
    const store = setup();

    const response = await GET(new Request("https://permudah.com/api/google/auth"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("accounts.google.com");
    expect(response.headers.get("location")).not.toContain("client-secret");

    const cookieName = "permudah_google_oauth_txn";
    const stored = store.map.get(cookieName);
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(COOKIE_SECRET);

    const transaction = await readGoogleOAuthTransaction(COOKIE_SECRET, stored!, { ttlMs: 10 * 60 * 1000 });
    expect(transaction?.userId).toBe("user-1");
    expect(transaction?.codeVerifier).toBeTruthy();
    expect(buildGoogleAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-123",
        redirectUri: "https://permudah.com/api/google/callback",
        state: transaction?.state,
        codeChallenge: expect.any(String),
      }),
    );
  });

  test("mints an entirely new transaction when the user retries", async () => {
    // The /google setup state's "Try again" points here, so a retry must never
    // reuse a prior transaction or its PKCE verifier: a new state, a new
    // verifier, and a new cookie are issued every time.
    setEnv({ ...FULL_ENV, NODE_ENV: "test" });
    const store = setup();

    const first = await GET(new Request("https://permudah.com/api/google/auth"));
    const firstCookie = store.map.get("permudah_google_oauth_txn")!;
    const firstTransaction = await readGoogleOAuthTransaction(COOKIE_SECRET, firstCookie, {
      ttlMs: 10 * 60 * 1000,
    });

    const second = await GET(new Request("https://permudah.com/api/google/auth"));
    const secondCookie = store.map.get("permudah_google_oauth_txn")!;
    const secondTransaction = await readGoogleOAuthTransaction(COOKIE_SECRET, secondCookie, {
      ttlMs: 10 * 60 * 1000,
    });

    expect(first.status).toBe(307);
    expect(second.status).toBe(307);
    expect(second.headers.get("location")).toContain("accounts.google.com");
    expect(secondCookie).not.toBe(firstCookie);
    expect(secondTransaction?.state).not.toBe(firstTransaction?.state);
    expect(secondTransaction?.codeVerifier).not.toBe(firstTransaction?.codeVerifier);
    expect(secondTransaction?.userId).toBe("user-1");
  });

  test("sends an unauthenticated visitor to login instead of Google", async () => {
    setEnv({ ...FULL_ENV, NODE_ENV: "test" });
    const store = setup({ userId: null });

    const response = await GET(new Request("https://permudah.com/api/google/auth"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://permudah.com/login?redirect=%2Fgoogle");
    expect(store.map.size).toBe(0);
    expect(buildGoogleAuthorizationUrl).not.toHaveBeenCalled();
  });

  test("does not start a flow when the signing secret is missing", async () => {
    setEnv({ ...FULL_ENV, GOOGLE_OAUTH_COOKIE_SECRET: undefined, NODE_ENV: "test" });
    const store = setup();

    const response = await GET(new Request("https://permudah.com/api/google/auth"));

    expect(response.status).toBe(200);
    expect(store.map.size).toBe(0);
    expect(buildGoogleAuthorizationUrl).not.toHaveBeenCalled();
  });

  test("requires an explicit redirect uri in production", async () => {
    setEnv({ ...FULL_ENV, GOOGLE_OAUTH_REDIRECT_URI: undefined, NODE_ENV: "production" });
    setup();

    const response = await GET(new Request("https://permudah.com/api/google/auth"));

    expect(response.status).toBe(200);
    expect(buildGoogleAuthorizationUrl).not.toHaveBeenCalled();
  });

  test("falls back to the request origin callback url outside production", async () => {
    setEnv({
      ...FULL_ENV,
      GOOGLE_OAUTH_REDIRECT_URI: undefined,
      NODE_ENV: "test",
    });
    setup();

    await GET(new Request("http://localhost:3000/api/google/auth"));

    expect(buildGoogleAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: "http://localhost:3000/api/google/callback" }),
    );
  });
});
