import { describe, expect, test } from "vitest";
import {
  createGoogleScriptProject,
  createGoogleScriptVersion,
  createGoogleWebAppDeployment,
  updateGoogleScriptContent,
} from "@/lib/google/apps-script";
import { fakeGoogleFetch, jsonBodyOf, TEST_CALL_CONTEXT } from "@/lib/google/test-utils";
import { GoogleError } from "@/lib/google/errors";

describe("createGoogleScriptProject", () => {
  test("creates a project bound to the spreadsheet when parentId is given", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects": {
        body: { scriptId: "script-1", title: "App" },
      },
    });

    const project = await createGoogleScriptProject(fetchImpl, "token-ok", "App", "file-1", TEST_CALL_CONTEXT);

    expect(project.scriptId).toBe("script-1");
    expect(jsonBodyOf(calls, "script.googleapis.com/v1/projects")).toMatchObject({
      title: "App",
      parentId: "file-1",
    });
  });

  test("authenticates every Apps Script call with the user's access token only", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects": { body: { scriptId: "script-1", title: "App" } },
      "script.googleapis.com/v1/projects/script-1/content": { body: null },
      "script.googleapis.com/v1/projects/script-1/versions": { body: { versionNumber: 1 } },
    });

    await createGoogleScriptProject(fetchImpl, "user-token", "App", null, TEST_CALL_CONTEXT);
    await updateGoogleScriptContent(fetchImpl, "user-token", "script-1", [
      { name: "Code", type: "SERVER_JS", source: "function doGet() {}" },
    ], TEST_CALL_CONTEXT);
    await createGoogleScriptVersion(fetchImpl, "user-token", "script-1", "v1", TEST_CALL_CONTEXT);

    expect(calls.length).toBe(3);
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer user-token");
      expect(call.init?.body ?? "").not.toContain("user-token");
    }
  });
  test("creates a standalone project when parentId is null", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects": { body: { scriptId: "script-1", title: "App" } },
    });

    await createGoogleScriptProject(fetchImpl, "token-ok", "App", null, TEST_CALL_CONTEXT);

    expect(jsonBodyOf(calls, "script.googleapis.com/v1/projects")).toEqual({ title: "App" });
  });
});

describe("updateGoogleScriptContent", () => {
  test("PUTs the files as the request body", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/content": { body: null },
    });

    await updateGoogleScriptContent(fetchImpl, "token-ok", "script-1", [
      { name: "Code", type: "SERVER_JS", source: "function doGet() {}" },
      { name: "appsscript", type: "JSON", source: "{}" },
    ], TEST_CALL_CONTEXT);

    const call = calls.find((c) => c.url.includes("/content"));
    expect(call?.init?.method).toBe("PUT");
    expect(jsonBodyOf(calls, "/content")).toMatchObject({
      files: [
        { name: "Code", type: "SERVER_JS" },
        { name: "appsscript", type: "JSON" },
      ],
    });
  });
});

describe("createGoogleScriptVersion", () => {
  test("returns the version number", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/versions": { body: { versionNumber: 3 } },
    });

    const version = await createGoogleScriptVersion(fetchImpl, "token-ok", "script-1", "v1", TEST_CALL_CONTEXT);

    expect(version).toBe(3);
    expect(jsonBodyOf(calls, "/versions")).toMatchObject({ description: "v1" });
  });

  test("throws when versionNumber is missing", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/versions": { body: {} },
    });

    await expect(
      createGoogleScriptVersion(fetchImpl, "token-ok", "script-1", "v1", TEST_CALL_CONTEXT),
    ).rejects.toBeInstanceOf(GoogleError);
  });
});

describe("createGoogleWebAppDeployment", () => {
  test("returns the Web App URL from the WEB_APP entry point", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": {
        body: {
          deploymentId: "AKfycb",
          entryPoints: [{ entryPointType: "WEB_APP", webApp: { url: "https://script.google.com/x" } }],
        },
      },
    });

    const deployment = await createGoogleWebAppDeployment(fetchImpl, "token-ok", "script-1", 3, "desc", TEST_CALL_CONTEXT);

    expect(deployment.webAppUrl).toBe("https://script.google.com/x");
    expect(deployment.deploymentId).toBe("AKfycb");
    expect(jsonBodyOf(calls, "/deployments")).toMatchObject({
      versionNumber: 3,
      manifestFileName: "appsscript",
      description: "desc",
    });
  });

  test("ignores non-web-app entry points", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": {
        body: {
          deploymentId: "AKfycb",
          entryPoints: [
            { entryPointType: "EXECUTION_API", executionApi: { entryPointConfig: {} } },
          ],
        },
      },
    });

    await expect(
      createGoogleWebAppDeployment(fetchImpl, "token-ok", "script-1", 3, "desc", TEST_CALL_CONTEXT),
    ).rejects.toMatchObject({ kind: "missing_web_app_url" });
  });

  test("rejects a Web App URL that is not hosted by Google", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": {
        body: {
          deploymentId: "AKfycb",
          entryPoints: [{ entryPointType: "WEB_APP", webApp: { url: "https://evil.example.com/x" } }],
        },
      },
    });

    await expect(
      createGoogleWebAppDeployment(fetchImpl, "token-ok", "script-1", 3, "desc", TEST_CALL_CONTEXT),
    ).rejects.toMatchObject({ kind: "missing_web_app_url" });
  });

  test("rejects a deployment response without a deployment id", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": {
        body: {
          entryPoints: [{ entryPointType: "WEB_APP", webApp: { url: "https://script.google.com/x" } }],
        },
      },
    });

    await expect(
      createGoogleWebAppDeployment(fetchImpl, "token-ok", "script-1", 3, "desc", TEST_CALL_CONTEXT),
    ).rejects.toBeInstanceOf(GoogleError);
  });

  test("maps an expired credential to unauthorized without leaking the token", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "script.googleapis.com/v1/projects/script-1/deployments": { status: 401, body: {} },
    });

    try {
      await createGoogleWebAppDeployment(fetchImpl, "super-secret-token", "script-1", 3, "desc", TEST_CALL_CONTEXT);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as GoogleError).kind).toBe("unauthorized");
      expect((error as Error).message).not.toContain("super-secret-token");
    }
  });
});