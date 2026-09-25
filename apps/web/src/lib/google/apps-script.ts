/**
 * Google Apps Script API (v1) client for the POC.
 *
 * Creates a script project bound to the user's spreadsheet, replaces its
 * content, snapshots a version, and deploys a Web App. All resources are
 * created in the authenticated user's Google account.
 *
 * The Apps Script API is used instead of browser automation for every step.
 */

import type { FetchLike } from "@/lib/google/http";
import { googleJsonRequest } from "@/lib/google/http";
import { GoogleError } from "@/lib/google/errors";
import type { GoogleCallContext } from "@/lib/google/logging";
import { isGoogleWebAppUrl } from "@/lib/google/urls";

const SCRIPT_BASE = "https://script.googleapis.com/v1";

export type GoogleScriptProject = {
  scriptId: string;
  title: string;
  parentId?: string | null;
  createTime?: string;
  updateTime?: string;
};

export type GoogleScriptFile = {
  name: string;
  type: "SERVER_JS" | "JSON" | "HTML";
  source: string;
};

/**
 * Create a new Apps Script project. When parentId (a Drive file id) is set,
 * the project is bound to that file (container-bound script). The script is
 * created and owned by the authenticated user.
 */
export async function createGoogleScriptProject(
  fetchImpl: FetchLike,
  accessToken: string,
  title: string,
  parentId: string | null,
  context: GoogleCallContext,
): Promise<GoogleScriptProject> {
  return googleJsonRequest<GoogleScriptProject>(fetchImpl, {
    url: `${SCRIPT_BASE}/projects`,
    accessToken,
    operation: "script.projects.create",
    correlationId: context.correlationId,
    method: "POST",
    body: parentId ? { title, parentId } : { title },
  });
}

/**
 * Read a project back. The create response does not reliably include
 * `parentId`, so the spreadsheet binding is confirmed with a separate read
 * instead of being assumed from the create call.
 */
export async function getGoogleScriptProject(
  fetchImpl: FetchLike,
  accessToken: string,
  scriptId: string,
  context: GoogleCallContext,
): Promise<GoogleScriptProject> {
  return googleJsonRequest<GoogleScriptProject>(fetchImpl, {
    url: `${SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}`,
    accessToken,
    operation: "script.projects.get",
    correlationId: context.correlationId,
    method: "GET",
  });
}

/**
 * Replace the project content (files + manifest). The project is brand new in
 * the POC, so a full replacement is safe and never overwrites user content.
 */
export async function updateGoogleScriptContent(
  fetchImpl: FetchLike,
  accessToken: string,
  scriptId: string,
  files: GoogleScriptFile[],
  context: GoogleCallContext,
): Promise<void> {
  await googleJsonRequest(fetchImpl, {
    url: `${SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}/content`,
    accessToken,
    operation: "script.projects.updateContent",
    correlationId: context.correlationId,
    method: "PUT",
    body: { files },
  });
}

/**
 * Create an immutable version snapshot of the project.
 */
export async function createGoogleScriptVersion(
  fetchImpl: FetchLike,
  accessToken: string,
  scriptId: string,
  description: string,
  context: GoogleCallContext,
): Promise<number> {
  const result = await googleJsonRequest<{ versionNumber?: number }>(fetchImpl, {
    url: `${SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}/versions`,
    accessToken,
    operation: "script.projects.versions.create",
    correlationId: context.correlationId,
    method: "POST",
    body: { description },
  });

  if (typeof result.versionNumber !== "number") {
    throw new GoogleError("google_api_error", "Apps Script version response had no versionNumber.");
  }
  return result.versionNumber;
}

export type GoogleWebAppDeployment = {
  deploymentId: string;
  webAppUrl: string;
};

/**
 * Create a Web App deployment for a given project version and return the
 * Web App entry point URL.
 */
export async function createGoogleWebAppDeployment(
  fetchImpl: FetchLike,
  accessToken: string,
  scriptId: string,
  versionNumber: number,
  description: string,
  context: GoogleCallContext,
): Promise<GoogleWebAppDeployment> {
  const deployment = (await googleJsonRequest(fetchImpl, {
    url: `${SCRIPT_BASE}/projects/${encodeURIComponent(scriptId)}/deployments`,
    accessToken,
    operation: "script.projects.deployments.create",
    correlationId: context.correlationId,
    method: "POST",
    body: {
      versionNumber,
      manifestFileName: "appsscript",
      description,
    },
  })) as {
    deploymentId?: string;
    entryPoints?: Array<{
      entryPointType?: string;
      webApp?: { url?: string };
    }>;
  };

  const webAppEntryPoint = (deployment.entryPoints ?? []).find(
    (entryPoint) => entryPoint.entryPointType === "WEB_APP",
  );

  const webAppUrl = webAppEntryPoint?.webApp?.url;
  if (typeof webAppUrl !== "string" || !isGoogleWebAppUrl(webAppUrl)) {
    throw new GoogleError(
      "missing_web_app_url",
      "The Apps Script deployment was created but returned no Web App URL.",
    );
  }

  const deploymentId = deployment.deploymentId;
  if (typeof deploymentId !== "string" || deploymentId.length === 0) {
    throw new GoogleError(
      "google_api_error",
      "The Apps Script deployment response contained no deployment id.",
    );
  }

  return { deploymentId, webAppUrl };
}