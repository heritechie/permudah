/**
 * Orchestrator: create a Web App that belongs to the USER's Google account.
 *
 * Permudah orchestrates the steps; Google owns and runs every resource:
 *   1. Spreadsheet in the user's Drive (Drive API, user's token).
 *   2. Ownership verification against the authorized Google account.
 *   3. Apps Script project bound to that spreadsheet (parentId).
 *   4. Minimal Web App content: Code.gs + index.html + appsscript.json.
 *   5. Immutable version.
 *   6. WEB_APP deployment, owner-only access.
 *   7. Web App URL returned to the caller.
 *
 * No service account, no shared Permudah Google account, no Permudah-hosted
 * copy of user data.
 */

import type { FetchLike } from "@/lib/google/http";
import { GoogleError, extractGoogleProjectNumber } from "@/lib/google/errors";
import { logGoogleEvent } from "@/lib/google/logging";
import { createGoogleSpreadsheet, getGoogleDriveFileOwners, trashGoogleDriveFile } from "@/lib/google/drive";
import {
  createGoogleScriptProject,
  getGoogleScriptProject,
  createGoogleScriptVersion,
  createGoogleWebAppDeployment,
  updateGoogleScriptContent,
} from "@/lib/google/apps-script";
import { isGoogleSpreadsheetUrl, isGoogleWebAppUrl } from "@/lib/google/urls";

export type UserOwnedWebApp = {
  appName: string;
  ownerEmail: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  scriptId: string;
  deploymentId: string;
  webAppUrl: string;
};

export type CreateWebAppConfig = {
  appName: string;
  ownerEmail: string;
};

export type CreateWebAppFailureReason =
  | "unauthorized"
  | "forbidden"
  | "service_disabled"
  | "apps_script_access_required"
  | "insufficient_scope"
  | "invalid_grant"
  | "not_found"
  | "rate_limited"
  | "missing_web_app_url"
  | "ownership_mismatch"
  | "google_api_error";

export type CreateWebAppResult =
  | { ok: true; data: UserOwnedWebApp }
  | {
      ok: false;
      reason: CreateWebAppFailureReason;
      message: string;
      /** Ties this failure to the structured server logs. */
      correlationId: string;
      /**
       * Google Cloud project number, when Google named one. Digits only, so it
       * is safe to show a user. Null when Google did not report it.
       */
      googleProjectNumber: string | null;
    };

const GOOGLE_KIND_TO_REASON: Record<GoogleError["kind"], CreateWebAppFailureReason> = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  service_disabled: "service_disabled",
  apps_script_access_required: "apps_script_access_required",
  insufficient_scope: "insufficient_scope",
  invalid_grant: "invalid_grant",
  not_found: "not_found",
  rate_limited: "rate_limited",
  missing_web_app_url: "missing_web_app_url",
  google_api_error: "google_api_error",
};

export const POC_WEB_APP_NAME = "Hello from Permudah";

class ProvisioningFailure extends Error {
  readonly reason: CreateWebAppFailureReason;

  constructor(reason: CreateWebAppFailureReason, message: string) {
    super(message);
    this.name = "ProvisioningFailure";
    this.reason = reason;
  }
}

/** appsscript.json source: owner-only Web App running as the deploying user. */
export function buildAppsScriptManifest(): string {
  return JSON.stringify(
    {
      timeZone: "UTC",
      dependencies: {},
      exceptionLogging: "STACKDRIVER",
      runtimeVersion: "V8",
      webapp: {
        executeAs: "USER_DEPLOYING",
        access: "MYSELF",
      },
    },
    null,
    2,
  );
}

/** Code.gs source for the POC Web App. */
export function buildAppsScriptSource(appName: string): string {
  return `var APP_NAME = ${JSON.stringify(appName)};

function doGet(e) {
  var title = APP_NAME;
  if (e && e.parameter && e.parameter.name) {
    title = String(e.parameter.name);
  }
  return HtmlService.createHtmlOutputFromFile("index")
    .setTitle(title)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** index.html source for the POC Web App. */
export function buildAppsScriptHtml(appName: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <base target="_top" />
    <meta charset="utf-8" />
    <style>
      body {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        max-width: 36em;
        margin: 4em auto;
        padding: 0 1em;
        color: #0f172a;
      }
      h1 { font-size: 1.75rem; margin-bottom: 0.5em; }
      p { line-height: 1.6; }
      footer { margin-top: 2.5em; font-size: 0.8rem; color: #64748b; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(appName)}</h1>
      <p>Hello from Permudah.</p>
      <p>
        This web app lives in <strong>your</strong> Google account. The spreadsheet and
        the Apps Script project were created in your Drive, and this page is served by
        your own Apps Script deployment.
      </p>
      <p>Permudah orchestrated the setup. It does not host this app or store its data.</p>
    </main>
    <footer>Created with Permudah.</footer>
  </body>
</html>
`;
}

export async function createUserOwnedWebApp(
  fetchImpl: FetchLike,
  accessToken: string,
  config: CreateWebAppConfig,
  correlationId: string,
): Promise<CreateWebAppResult> {
  const context = { correlationId };
  let spreadsheetId: string | null = null;

  try {
    const spreadsheet = await createGoogleSpreadsheet(fetchImpl, accessToken, config.appName, context);
    spreadsheetId = spreadsheet.id;

    if (!spreadsheetId) {
      throw new GoogleError("google_api_error", "Drive did not return a file id for the new spreadsheet.");
    }

    const owners = await getGoogleDriveFileOwners(fetchImpl, accessToken, spreadsheetId, context);
    if (!owners.includes(config.ownerEmail.toLowerCase())) {
      throw new ProvisioningFailure(
        "ownership_mismatch",
        "The created spreadsheet is not owned by the authenticated Google account.",
      );
    }

    const spreadsheetUrl =
      spreadsheet.webViewLink ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    if (!isGoogleSpreadsheetUrl(spreadsheetUrl)) {
      throw new GoogleError("google_api_error", "Drive returned an unexpected spreadsheet URL.");
    }

    const createdProject = await createGoogleScriptProject(
      fetchImpl,
      accessToken,
      config.appName,
      spreadsheetId,
      context,
    );

    if (!createdProject.scriptId) {
      throw new GoogleError("google_api_error", "Apps Script did not return a script id.");
    }

    // Confirm the project really is bound to this user's spreadsheet.
    const project = await getGoogleScriptProject(fetchImpl, accessToken, createdProject.scriptId, context);
    if (project.parentId !== spreadsheetId) {
      throw new ProvisioningFailure(
        "ownership_mismatch",
        "The Apps Script project is not bound to the spreadsheet created for this user.",
      );
    }

    await updateGoogleScriptContent(
      fetchImpl,
      accessToken,
      project.scriptId,
      [
        { name: "Code", type: "SERVER_JS", source: buildAppsScriptSource(config.appName) },
        { name: "index", type: "HTML", source: buildAppsScriptHtml(config.appName) },
        { name: "appsscript", type: "JSON", source: buildAppsScriptManifest() },
      ],
      context,
    );

    const version = await createGoogleScriptVersion(
      fetchImpl,
      accessToken,
      project.scriptId,
      "Permudah: Hello from Permudah",
      context,
    );

    const deployment = await createGoogleWebAppDeployment(
      fetchImpl,
      accessToken,
      project.scriptId,
      version,
      "Permudah: Hello from Permudah",
      context,
    );

    if (!isGoogleWebAppUrl(deployment.webAppUrl)) {
      throw new GoogleError("missing_web_app_url", "The deployment returned an unexpected Web App URL.");
    }

    logGoogleEvent({
      correlationId,
      event: "google_provisioning_succeeded",
      appName: config.appName,
    });

    return {
      ok: true,
      data: {
        appName: config.appName,
        ownerEmail: config.ownerEmail,
        spreadsheetId,
        spreadsheetUrl,
        scriptId: project.scriptId,
        deploymentId: deployment.deploymentId,
        webAppUrl: deployment.webAppUrl,
      },
    };
  } catch (error) {
    // Cleanup first, then report. A cleanup failure is logged inside
    // trashGoogleDriveFile and must never replace the original reason.
    if (spreadsheetId) {
      await trashGoogleDriveFile(fetchImpl, accessToken, spreadsheetId, context);
    }

    if (error instanceof ProvisioningFailure) {
      logGoogleEvent({
        correlationId,
        event: "google_provisioning_failed",
        level: "error",
        reason: error.reason,
        detail: error.message,
        spreadsheetCreated: Boolean(spreadsheetId),
      });
      return {
        ok: false,
        reason: error.reason,
        message: error.message,
        correlationId,
        googleProjectNumber: null,
      };
    }

    if (error instanceof GoogleError) {
      const reason = GOOGLE_KIND_TO_REASON[error.kind];
      logGoogleEvent({
        correlationId,
        event: "google_provisioning_failed",
        level: "error",
        reason,
        googleErrorKind: error.kind,
        googleCode: error.code,
        status: error.status,
        detail: error.message,
        spreadsheetCreated: Boolean(spreadsheetId),
      });
      return {
        ok: false,
        reason,
        message: error.message,
        correlationId,
        googleProjectNumber:
          reason === "service_disabled" ? extractGoogleProjectNumber(error.message) : null,
      };
    }

    logGoogleEvent({
      correlationId,
      event: "google_provisioning_failed",
      level: "error",
      reason: "google_api_error",
      detail: "Unexpected non-Google error while creating the web app.",
      spreadsheetCreated: Boolean(spreadsheetId),
    });
    return {
      ok: false,
      reason: "google_api_error",
      message: "Unexpected error while creating the web app.",
      correlationId,
      googleProjectNumber: null,
    };
  }
}
