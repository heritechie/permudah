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

const APPS_SCRIPT_SETTINGS_URL = "https://script.google.com/home/usersettings";

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
  return renderToStaticMarkup(await GooglePage({ searchParams: Promise.resolve(params) }));
}

describe("/google page", () => {
  test("redirects an anonymous visitor to the normal login flow", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);

    await expect(renderPage()).rejects.toThrow("Redirect: /login?redirect=%2Fgoogle");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?redirect=%2Fgoogle");
  });

  test("renders for a signed-in user", async () => {
    const html = await renderPage();

    expect(html).toContain("Build a Web App");
    expect(html).toContain("/api/google/auth");
    expect(html).not.toContain("undefined");
  });
});

describe("/google page prerequisites", () => {
  test("explains what the user will get", async () => {
    const html = await renderPage();

    expect(html).toContain("What you&#x27;ll get");
    expect(html).toContain("A spreadsheet created in your Google Drive");
    expect(html).toContain("An Apps Script project bound to that spreadsheet");
    expect(html).toContain("A web app deployed from your Apps Script project");
    expect(html).toContain("You&#x27;ll keep ownership");
  });

  test("states the Apps Script API prerequisite", async () => {
    const html = await renderPage();

    expect(html).toContain("Google setup");
    expect(html).toContain("allow Apps Script API access to your script projects");
    expect(html).toContain("You only need to do this once");
    expect(html).toContain("Open Apps Script settings");
    expect(html).toContain("After enabling it, return here and continue.");
  });

  test("links to exactly the trusted Google Apps Script settings URL", async () => {
    const html = await renderPage();

    expect(html).toContain(`href="${APPS_SCRIPT_SETTINGS_URL}"`);
    // No other external host is linked from this page.
    const externalHosts = [...html.matchAll(/href="https?:\/\/([^/"]+)/g)].map((match) => match[1]);
    expect([...new Set(externalHosts)]).toEqual(["script.google.com"]);
  });

  test("opens external links safely", async () => {
    const html = await renderPage();

    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  test("keeps Connect Google as the main action", async () => {
    const html = await renderPage();

    expect(html).toContain("Connect Google");
  });
});

describe("/google page setup honesty", () => {
  test("claims no ownership before anything is created", async () => {
    const html = await renderPage();

    // No completed-state tick marks and no present-tense ownership claim.
    expect(html).not.toContain("✓");
    expect(html).not.toContain("You own");
    expect(html).not.toContain("You already own");
    expect(html).not.toContain("Web app ready");
    expect(html).not.toContain("Ready");
  });

  test("does not present resource identifiers before provisioning", async () => {
    // Nothing is rendered from a resource id, and no "created" state is claimed.
    const html = await renderPage();

    expect(html).not.toMatch(/script-1|AKfycb|docs\.google\.com\/spreadsheets/);
    expect(html).not.toContain("created successfully");
  });

  test("does not invent a preflight check before authorization", async () => {
    // Permudah holds no Google authorization before Connect Google, so the page
    // must not claim to have checked anything.
    const html = await renderPage();

    expect(html).not.toMatch(/API is (already )?enabled/i);
    expect(html).not.toMatch(/\bchecked\b|\bwe verified\b|connected your Google account/i);
  });

  test("never asks the end user to configure Google Cloud", async () => {
    // Enabling an API on a Cloud project is Permudah's operator job, not the
    // user's. No state may point an end user at Google Cloud.
    const states: Record<string, string>[] = [
      {},
      { error: "apps_script_access_required" },
      { error: "service_disabled", project: "887739439651" },
      { error: "forbidden" },
    ];
    for (const params of states) {
      const html = await renderPage(params);
      expect(html, JSON.stringify(params)).not.toMatch(/Google Cloud/i);
      expect(html, JSON.stringify(params)).not.toMatch(/console\.google\.com/i);
      expect(html, JSON.stringify(params)).not.toMatch(/enable the .{0,40}API .{0,20}(in|on) .{0,30}project/i);
      expect(html, JSON.stringify(params)).not.toContain("887739439651");
    }
  });
});

describe("/google page error states", () => {
  test("shows the user-access state when the account has not granted Apps Script access", async () => {
    const html = await renderPage({ error: "apps_script_access_required" });

    expect(html).toContain("Allow Apps Script access");
    expect(html).toContain("allow Apps Script API access to your script projects");
    expect(html).toContain("You only need to do this once");
    expect(html).toContain("Nothing was created and nothing was deleted");
  });

  test("offers the settings link and a safe retry in the user-access state", async () => {
    const html = await renderPage({ error: "apps_script_access_required" });

    expect(html).toContain(`href="${APPS_SCRIPT_SETTINGS_URL}"`);
    expect(html).toContain("Open Apps Script settings");
    expect(html).toContain("Try again");
    expect(html).toContain("After enabling it, return here and try again.");
    // Retry restarts authorization: it reuses no prior state, verifier, or token.
    expect(html).toContain('href="/api/google/auth"');
    expect(html).not.toContain("/api/google/callback");
  });

  test("shows a support reference in the user-access state", async () => {
    const html = await renderPage({
      error: "apps_script_access_required",
      ref: "abc123XYZ_-987",
    });

    expect(html).toContain("Reference for support");
    expect(html).toContain("abc123XYZ_-987");
  });

  test("treats a disabled Cloud-project API as an operator fault, not a user step", async () => {
    const html = await renderPage({ error: "service_disabled", ref: "abc123XYZ_-987" });

    expect(html).toContain("configuration problem on our side");
    expect(html).toContain("Nothing was created and nothing was deleted");
    expect(html).toContain("Reference for support");
    expect(html).toContain("abc123XYZ_-987");
    // The user is given nothing to click, and no Cloud project to poke at.
    expect(html).not.toContain("Allow Apps Script access");
    expect(html).not.toContain("Try again");
    expect(html).not.toMatch(/Google Cloud/i);
    expect(html).not.toMatch(/console\.google\.com/i);
  });

  test("does not show the user-access state for unrelated failures", async () => {
    for (const reason of [
      "service_disabled",
      "forbidden",
      "token_exchange_failed",
      "registry_failed",
      "denied",
    ]) {
      const html = await renderPage({ error: reason });
      expect(html, reason).not.toContain("Allow Apps Script access");
      expect(html, reason).not.toContain("Try again");
    }
  });

  test("does not show the user-access state for an unknown code", async () => {
    const html = await renderPage({ error: "apps_script_access" });

    expect(html).toContain("The Google connection failed.");
    expect(html).not.toContain("Allow Apps Script access");
  });

  test("distinguishes a registry failure from a Google failure", async () => {
    const html = await renderPage({ error: "registry_failed" });

    expect(html).toContain("created in your Google account");
    expect(html).toContain("Nothing was deleted");
  });

  test("falls back to a generic message for an unknown error code", async () => {
    const html = await renderPage({ error: "totally_unknown" });

    expect(html).toContain("The Google connection failed.");
  });

  test("never renders a raw Google error message from the query string", async () => {
    const hostile =
      "Google Apps Script API has not been used in project 887739439651 %3Cscript%3Ealert(1)%3C%2Fscript%3E";
    const html = await renderPage({ error: hostile });

    expect(html).not.toContain("has not been used");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("The Google connection failed.");
  });

  test("never renders an unvalidated project or reference value", async () => {
    const html = await renderPage({
      error: "apps_script_access_required",
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
});
