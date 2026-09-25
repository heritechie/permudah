import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreProcessEnv, setProcessEnv, snapshotProcessEnv } from "@/lib/google/test-utils";

class RedirectError extends Error {
  constructor(url: string) {
    super(`Redirect: ${url}`);
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  cookies: vi.fn(),
  getAuthenticatedSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));

const { signWebAppResult } = await import("@/lib/google/result");
const GoogleResultPage = (await import("./page")).default;

const COOKIE_SECRET = "test-cookie-secret-that-is-long-enough-1234";
const RESULT_COOKIE = "permudah_google_result";
const TTL_MS = 10 * 60 * 1000;

const originalEnv = snapshotProcessEnv(["GOOGLE_OAUTH_COOKIE_SECRET", "NODE_ENV"]);

beforeEach(() => {
  setProcessEnv("GOOGLE_OAUTH_COOKIE_SECRET", COOKIE_SECRET);
  setProcessEnv("NODE_ENV", "test");
});

afterEach(() => {
  restoreProcessEnv(originalEnv);
  vi.clearAllMocks();
});

function mockCookie(value?: string) {
  mocks.cookies.mockResolvedValue({
    get: (name: string) =>
      name === RESULT_COOKIE && value !== undefined ? { name, value } : undefined,
  });
}

function mockUser(userId: string | null) {
  mocks.getAuthenticatedSession.mockResolvedValue(
    userId ? ({ supabase: {} as never, user: { id: userId } }) : null,
  );
}

const RESULT = {
  appName: "Hello from Permudah",
  ownerEmail: "creator@example.com",
  spreadsheetId: "sheet-1",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
  scriptId: "script-1",
  webAppUrl: "https://script.google.com/macros/s/abc/exec",
  userId: "user-1",
};

async function render() {
  try {
    const element = await GoogleResultPage();
    return { html: renderToStaticMarkup(element), redirected: null as string | null };
  } catch (error) {
    if (error instanceof RedirectError) {
      return { html: null, redirected: error.message };
    }
    throw error;
  }
}

describe("GoogleResultPage", () => {
  test("renders the signed, user-bound result", async () => {
    mockUser("user-1");
    mockCookie(await signWebAppResult(COOKIE_SECRET, RESULT));

    const { html, redirected } = await render();

    expect(redirected).toBeNull();
    expect(html).toContain("https://script.google.com/macros/s/abc/exec");
    expect(html).toContain("https://docs.google.com/spreadsheets/d/sheet-1/edit");
    expect(html).toContain("creator@example.com");
  });

  test("redirects an unauthenticated visitor to login", async () => {
    mockUser(null);
    mockCookie();

    const { redirected } = await render();

    expect(redirected).toContain("/login?redirect=%2Fgoogle%2Fresult");
  });

  test("shows no result when the reference belongs to another Permudah user", async () => {
    mockUser("user-2");
    mockCookie(await signWebAppResult(COOKIE_SECRET, RESULT));

    const { html } = await render();

    expect(html).toContain("No web app to show");
    expect(html).not.toContain("script.google.com");
  });

  test("shows no result when the cookie is missing", async () => {
    mockUser("user-1");
    mockCookie();

    const { html } = await render();

    expect(html).toContain("No web app to show");
  });

  test("shows no result for a tampered cookie", async () => {
    mockUser("user-1");
    const valid = await signWebAppResult(COOKIE_SECRET, RESULT);
    mockCookie(`${valid.slice(0, valid.indexOf("."))}.forged`);

    const { html } = await render();

    expect(html).toContain("No web app to show");
    expect(html).not.toContain("script.google.com");
  });

  test("shows no result for an expired reference", async () => {
    mockUser("user-1");
    const expired = await signWebAppResult(COOKIE_SECRET, {
      ...RESULT,
      now: Date.now() - TTL_MS - 1000,
    });
    mockCookie(expired);

    const { html } = await render();

    expect(html).toContain("No web app to show");
  });

  test("shows no result for a non-Google web app url", async () => {
    mockUser("user-1");
    mockCookie(await signWebAppResult(COOKIE_SECRET, { ...RESULT, webAppUrl: "https://evil.example.com" }));

    const { html } = await render();

    expect(html).toContain("No web app to show");
    expect(html).not.toContain("evil.example.com");
  });

  test("never renders a Google credential from any source", async () => {
    mockUser("user-1");
    const valid = await signWebAppResult(COOKIE_SECRET, RESULT);
    mockCookie(valid);

    const { html } = await render();

    expect(html).not.toContain("ya29.");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain(COOKIE_SECRET);
  });
});
