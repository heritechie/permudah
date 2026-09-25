import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

class RedirectError extends Error {
  constructor(url: string) {
    super(`Redirect: ${url}`);
  }
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new RedirectError(url);
  }),
  getAuthenticatedSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));

const GooglePage = (await import("./page")).default;

beforeEach(() => {
  mocks.getAuthenticatedSession.mockResolvedValue({
    supabase: {} as never,
    user: { id: "user-1" },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function renderPage(params: Record<string, string> = {}) {
  return renderToStaticMarkup(
    await GooglePage({ searchParams: Promise.resolve(params) }),
  );
}

describe("/google page", () => {
  test("redirects an anonymous visitor to the normal login flow", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("Redirect: /login?redirect=%2Fgoogle");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?redirect=%2Fgoogle");
  });

  test("renders the connect page for a signed-in user", async () => {
    const html = await renderPage();

    expect(html).toContain("Build a Web App");
    expect(html).toContain("/api/google/auth");
    expect(html).not.toContain("undefined");
  });

  test("explains a disabled Google API and names the project", async () => {
    const html = await renderPage({ error: "service_disabled", project: "887739439651" });

    expect(html).toContain("not enabled yet");
    expect(html).toContain("887739439651");
    expect(html).toContain("Apps Script API");
  });

  test("omits the project hint when no project was reported", async () => {
    const html = await renderPage({ error: "service_disabled" });

    expect(html).toContain("not enabled yet");
    expect(html).not.toContain("Google Cloud project");
  });

  test("never renders an unvalidated project or reference value", async () => {
    const html = await renderPage({
      error: "service_disabled",
      project: "<script>alert(1)</script>",
      ref: "'; DROP TABLE google_web_apps; --",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("DROP TABLE");
    expect(html).not.toContain("Reference for support");
  });

  test("shows a support reference when one is supplied", async () => {
    const html = await renderPage({ error: "forbidden", ref: "abc123XYZ_-987" });

    expect(html).toContain("Reference for support");
    expect(html).toContain("abc123XYZ_-987");
  });

  test("distinguishes a registry failure from a Google failure", async () => {
    const html = await renderPage({ error: "registry_failed" });

    expect(html).toContain("created in your Google account");
    expect(html).toContain("could not save a record");
    expect(html).toContain("Nothing was deleted");
  });

  test("falls back to a generic message for an unknown error code", async () => {
    const html = await renderPage({ error: "totally_unknown" });

    expect(html).toContain("The Google connection failed.");
  });
});
