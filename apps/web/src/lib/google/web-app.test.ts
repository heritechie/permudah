import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildAppsScriptHtml,
  buildAppsScriptManifest,
  buildAppsScriptSource,
  createUserOwnedWebApp,
  POC_WEB_APP_NAME,
} from "@/lib/google/web-app";
import { authHeaderOf, fakeGoogleFetch, jsonBodyOf, TEST_CALL_CONTEXT } from "@/lib/google/test-utils";

const ownerEmail = "creator@example.com";

function happyPathRoutes(): Parameters<typeof fakeGoogleFetch>[0] {
  return {
    "www.googleapis.com/drive/v3/files?": {
      body: {
        id: "sheet-1",
        name: "Hello from Permudah",
        mimeType: "application/vnd.google-apps.spreadsheet",
        webViewLink: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
      },
    },
    "www.googleapis.com/drive/v3/files/sheet-1": {
      body: { owners: [{ emailAddress: "Creator@example.com" }] },
    },
    "script.googleapis.com/v1/projects": {
      body: { scriptId: "script-1", title: "Hello from Permudah" },
    },
    "script.googleapis.com/v1/projects/script-1": {
      body: { scriptId: "script-1", title: "Hello from Permudah", parentId: "sheet-1" },
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
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generated Apps Script project files", () => {
  test("Code.gs serves index.html and titles it with the app name", () => {
    const source = buildAppsScriptSource("Hello from Permudah");
    expect(source).toContain("function doGet(e)");
    expect(source).toContain('var APP_NAME = "Hello from Permudah"');
    expect(source).toContain('createHtmlOutputFromFile("index")');
  });

  test("Code.gs escapes quotes in the app name", () => {
    const source = buildAppsScriptSource('Hello "Foo"');
    expect(source).toContain('var APP_NAME = "Hello \\"Foo\\""');
  });

  test("index.html displays the app name and the ownership message", () => {
    const html = buildAppsScriptHtml("Hello from Permudah");
    expect(html).toContain("<h1>Hello from Permudah</h1>");
    expect(html).toContain("Hello from Permudah.");
    expect(html).toContain("your</strong> Google account");
  });

  test("index.html escapes html in the app name", () => {
    const html = buildAppsScriptHtml('<script>"x"</script>');
    expect(html).toContain("&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  test("appsscript.json deploys as the user with owner-only access", () => {
    const manifest = JSON.parse(buildAppsScriptManifest());
    expect(manifest.webapp).toEqual({ executeAs: "USER_DEPLOYING", access: "MYSELF" });
    expect(manifest.runtimeVersion).toBe("V8");
  });
});

describe("createUserOwnedWebApp", () => {
  test("creates spreadsheet, bound script, version, and web app deployment in order", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch(happyPathRoutes());

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.webAppUrl).toBe("https://script.google.com/macros/s/abc/exec");
    expect(result.data.spreadsheetId).toBe("sheet-1");
    expect(result.data.scriptId).toBe("script-1");
    expect(result.data.deploymentId).toBe("AKfycb_abc");
    expect(result.data.ownerEmail).toBe(ownerEmail);

    const urls = calls.map((call) => call.url);
    const positions = [
      "/drive/v3/files?",
      "/drive/v3/files/sheet-1",
      "script.googleapis.com/v1/projects",
      "/projects/script-1/content",
      "/projects/script-1/versions",
      "/projects/script-1/deployments",
    ].map((needle) => urls.findIndex((url) => url.includes(needle)));
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }

    // The project is read back to confirm the spreadsheet binding before any
    // content is written.
    const readBackIndex = urls.findIndex(
      (url) => url.endsWith("/projects/script-1") && url.includes("script.googleapis.com"),
    );
    expect(readBackIndex).toBeGreaterThan(positions[2]);
    expect(readBackIndex).toBeLessThan(positions[3]);

    const projectCall = calls.find(
      (call) =>
        call.url.includes("script.googleapis.com/v1/projects") &&
        !call.url.includes("/content") &&
        !call.url.includes("/versions") &&
        !call.url.includes("/deployments") &&
        !call.url.endsWith("/projects/script-1"),
    )!;
    expect(projectCall.init?.method).toBe("POST");
    expect(projectCall.init?.body).toContain('"parentId":"sheet-1"');

    const contentBody = jsonBodyOf(calls, "/projects/script-1/content");
    expect(contentBody).toMatchObject({
      files: [
        { name: "Code", type: "SERVER_JS" },
        { name: "index", type: "HTML" },
        { name: "appsscript", type: "JSON" },
      ],
    });

    for (const url of urls) {
      expect(authHeaderOf(calls, new URL(url).pathname)).toBe("Bearer token-ok");
    }
  });

  test("uses the minimal Drive file creation request (no full Drive scope needed)", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch(happyPathRoutes());

    await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(jsonBodyOf(calls, "/drive/v3/files?")).toEqual({
      name: POC_WEB_APP_NAME,
      mimeType: "application/vnd.google-apps.spreadsheet",
    });
  });

  test("returns ownership_mismatch and cleans up when the sheet owner differs", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      ...happyPathRoutes(),
      "www.googleapis.com/drive/v3/files/sheet-1": {
        body: { owners: [{ emailAddress: "hacker@example.com" }] },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "ownership_mismatch" });
    const cleanup = calls.find((call) => call.init?.method === "DELETE");
    expect(cleanup?.url).toContain("/drive/v3/files/sheet-1");
  });

  test("returns ownership_mismatch when the script is not bound to the user's sheet", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      ...happyPathRoutes(),
      "script.googleapis.com/v1/projects/script-1": {
        body: { scriptId: "script-1", title: "App", parentId: "someone-elses-file" },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "ownership_mismatch" });
  });

  test("returns ownership_mismatch when the project reports no parent at all", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      ...happyPathRoutes(),
      "script.googleapis.com/v1/projects/script-1": { body: { scriptId: "script-1", title: "App" } },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "ownership_mismatch" });
  });

  test("matches the owner case-insensitively", async () => {
    const { fetchImpl } = fakeGoogleFetch(happyPathRoutes());
    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail: "Creator@Example.COM",
    }, TEST_CALL_CONTEXT.correlationId);
    expect(result.ok).toBe(true);
  });

  test("returns unauthorized on expired or invalid credentials", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": { status: 401, body: {} },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-expired", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  test("returns forbidden when Google rejects the call", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": {
        status: 403,
        body: { error: { status: "PERMISSION_DENIED" } },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  test("returns service_disabled and the project when the Google API is not enabled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects": {
        status: 403,
        body: {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message:
              "Google Apps Script API has not been used in project 887739439651 before or it is disabled.",
            errors: [{ reason: "SERVICE_DISABLED", domain: "googleapis.com" }],
          },
        },
      },
      "www.googleapis.com/drive/v3/files?": {
        body: {
          id: "file-1",
          name: "App",
          webViewLink: "https://docs.google.com/spreadsheets/d/file-1/edit",
        },
      },
      "www.googleapis.com/drive/v3/files/file-1": {
        body: { owners: [{ emailAddress: ownerEmail }] },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({
      ok: false,
      reason: "service_disabled",
      correlationId: TEST_CALL_CONTEXT.correlationId,
      googleProjectNumber: "887739439651",
    });
  });

  test("returns apps_script_access_required when the account never granted script access", async () => {
    // The per-user grant, not a Cloud-project fault: the user can fix this at
    // script.google.com/home/usersettings.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects": {
        status: 403,
        body: {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message:
              "User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.",
            errors: [{ message: "User has not enabled the Apps Script API.", domain: "global", reason: "forbidden" }],
          },
        },
      },
      "www.googleapis.com/drive/v3/files?": {
        body: {
          id: "file-1",
          name: "App",
          webViewLink: "https://docs.google.com/spreadsheets/d/file-1/edit",
        },
      },
      "www.googleapis.com/drive/v3/files/file-1": {
        body: { owners: [{ emailAddress: ownerEmail }] },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({
      ok: false,
      reason: "apps_script_access_required",
      correlationId: TEST_CALL_CONTEXT.correlationId,
      // There is no Cloud project to report for a per-user grant problem.
      googleProjectNumber: null,
    });
  });

  test("returns service_disabled for the ACCESS_NOT_CONFIGURED variant too", async () => {
    // Drive reports the same missing-API condition as ACCESS_NOT_CONFIGURED
    // instead of SERVICE_DISABLED. Both must reach the UI as a setup state
    // rather than as a permission failure.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": {
        status: 403,
        body: {
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "Access Not Configured. Please ask your administrator to configure your API.",
            errors: [{ reason: "ACCESS_NOT_CONFIGURED", domain: "global" }],
          },
        },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({
      ok: false,
      reason: "service_disabled",
      correlationId: TEST_CALL_CONTEXT.correlationId,
    });
  });

  test("reports no project number when Google did not name one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": {
        status: 403,
        body: {
          error: {
            status: "PERMISSION_DENIED",
            message: "The API is disabled.",
            errors: [{ reason: "SERVICE_DISABLED" }],
          },
        },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "service_disabled", googleProjectNumber: null });
  });

  test("returns insufficient_scope when a scope is missing", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": {
        status: 403,
        body: { error: { code: 403, message: "Request had insufficient authentication scopes." } },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "insufficient_scope" });
  });

  test("returns rate_limited on 429", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files?": { status: 429, body: {} },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  test("returns missing_web_app_url when the deployment has no URL", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      ...happyPathRoutes(),
      "script.googleapis.com/v1/projects/script-1/deployments": {
        body: { deploymentId: "AKfycb_x", entryPoints: [] },
      },
    });

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "missing_web_app_url" });
  });

  test("never includes tokens in the result", async () => {
    const { fetchImpl } = fakeGoogleFetch(happyPathRoutes());
    const result = await createUserOwnedWebApp(fetchImpl, "token-super-secret", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("token-super-secret");
    expect(Object.keys(result.ok ? result.data : result)).not.toContain("accessToken");
  });

  test("never logs the access token, even on unexpected failures", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => void logged.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...args) => void logged.push(args.join(" ")));

    const fetchImpl = async (): Promise<Response> => {
      throw new Error("network reset for token-ultra-secret");
    };

    const result = await createUserOwnedWebApp(fetchImpl, "token-ultra-secret", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "google_api_error" });
    expect(JSON.stringify(result)).not.toContain("token-ultra-secret");
    expect(logged.join("\n")).not.toContain("token-ultra-secret");
  });

  test("maps unexpected errors to google_api_error", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("network reset");
    };

    const result = await createUserOwnedWebApp(fetchImpl, "token-ok", {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    }, TEST_CALL_CONTEXT.correlationId);

    expect(result).toMatchObject({ ok: false, reason: "google_api_error" });
  });
});
