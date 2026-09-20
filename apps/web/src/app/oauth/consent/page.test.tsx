import { describe, expect, test, vi } from "vitest";

class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super(`Redirect: ${url}`);
    this.url = url;
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

const { redirect, createClient } = mocks;

const OAuthConsentPage = (await import("./page")).default;

function fakeSupabase({
  user = null,
  details = null,
  error = null,
}: {
  user?: { id: string; email: string } | null;
  details?: { authorization_id: string; redirect_uri: string; client: { name: string }; user: { id: string; email: string }; scope: string } | { redirect_url: string } | null;
  error?: { message: string } | null;
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
      oauth: {
        getAuthorizationDetails: vi.fn(async () => ({ data: details, error })),
      },
    },
  };
}

async function renderPage(searchParams: { authorization_id?: string }) {
  vi.mocked(redirect).mockClear();
  try {
    const result = await OAuthConsentPage({ searchParams: Promise.resolve(searchParams) });
    return { result, redirectUrl: null };
  } catch (err) {
    if (err instanceof RedirectError) {
      return { result: null, redirectUrl: err.url };
    }
    throw err;
  }
}

describe("OAuthConsentPage", () => {
  test("redirects to login with error when authorization_id is missing", async () => {
    const { redirectUrl } = await renderPage({});
    expect(redirectUrl).toBe("/login?error=missing_authorization");
  });

  test("redirects unauthenticated user to login with redirect preservation", async () => {
    const supabase = fakeSupabase({ user: null });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as ReturnType<typeof import("@/lib/supabase/server").createClient>);

    const { redirectUrl } = await renderPage({ authorization_id: "authz-1" });

    expect(redirectUrl).toBe("/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dauthz-1");
  });

  test("redirects to login with error for invalid authorization request", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1", email: "a@example.com" },
      error: { message: "Authorization not found" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as ReturnType<typeof import("@/lib/supabase/server").createClient>);

    const { redirectUrl } = await renderPage({ authorization_id: "authz-1" });

    expect(redirectUrl).toBe("/login?error=invalid_authorization");
  });

  test("redirects when authorization is already completed", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1", email: "a@example.com" },
      details: { redirect_url: "https://client.example.com/callback?code=abc" },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as ReturnType<typeof import("@/lib/supabase/server").createClient>);

    const { redirectUrl } = await renderPage({ authorization_id: "authz-1" });

    expect(redirectUrl).toBe("https://client.example.com/callback?code=abc");
  });

  test("renders consent UI with authorization details", async () => {
    const supabase = fakeSupabase({
      user: { id: "user-1", email: "a@example.com" },
      details: {
        authorization_id: "authz-1",
        redirect_uri: "https://client.example.com/callback",
        client: { name: "Test App" },
        user: { id: "user-1", email: "a@example.com" },
        scope: "openid profile email",
      },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as ReturnType<typeof import("@/lib/supabase/server").createClient>);

    const { result, redirectUrl } = await renderPage({ authorization_id: "authz-1" });

    expect(redirectUrl).toBeNull();
    expect(result).toBeDefined();
    const html = JSON.stringify(result);
    expect(html).toContain("Test App");
    expect(html).toContain("Authorize");
    expect(html).toContain("openid");
    expect(html).toContain("profile");
    expect(html).toContain("email");
  });
});
