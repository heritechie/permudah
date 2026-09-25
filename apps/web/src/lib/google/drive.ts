/**
 * Google Drive API (v3) client for the POC.
 *
 * Only app-created files are touched, so the minimal `drive.file` scope is
 * sufficient. The access token is server-side only and never logged.
 */

import type { FetchLike } from "@/lib/google/http";
import { googleJsonRequest } from "@/lib/google/http";
import { GoogleError } from "@/lib/google/errors";
import type { GoogleCallContext } from "@/lib/google/logging";
import { logGoogleEvent } from "@/lib/google/logging";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  webViewLink?: string;
};

/**
 * Create a new Google Spreadsheet in the authenticated user's Drive,
 * owned by that user (the app never owns the file).
 */
export async function createGoogleSpreadsheet(
  fetchImpl: FetchLike,
  accessToken: string,
  name: string,
  context: GoogleCallContext,
): Promise<GoogleDriveFile> {
  const url = new URL(`${DRIVE_BASE}/files`);
  url.searchParams.set("fields", "id,name,mimeType,webViewLink");

  return googleJsonRequest<GoogleDriveFile>(fetchImpl, {
    url: url.toString(),
    accessToken,
    operation: "drive.files.create",
    correlationId: context.correlationId,
    method: "POST",
    body: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
    },
  });
}

/**
 * Read the owners of a given file. Under `drive.file`, this works for files
 * created by this app. Used to verify the created spreadsheet belongs to the
 * authenticated Google account.
 */
export async function getGoogleDriveFileOwners(
  fetchImpl: FetchLike,
  accessToken: string,
  fileId: string,
  context: GoogleCallContext,
): Promise<string[]> {
  const url = new URL(`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "owners(emailAddress)");

  const file = await googleJsonRequest<{ owners?: Array<{ emailAddress?: string }> }>(
    fetchImpl,
    {
      url: url.toString(),
      accessToken,
      operation: "drive.files.get",
      correlationId: context.correlationId,
    },
  );

  const owners = (file.owners ?? [])
    .map((owner) => owner.emailAddress?.toLowerCase())
    .filter((email): email is string => typeof email === "string" && email.length > 0);

  if (owners.length === 0) {
    throw new GoogleError(
      "unauthorized",
      "Could not read the Drive file owner list. The access token may be expired or the file is not accessible.",
    );
  }

  return owners;
}

export type GoogleCleanupResult =
  | { ok: true }
  | { ok: false; status: number | null; code: string | null; reason: string };

/**
 * Best-effort cleanup: move a file this flow just created to the user's trash.
 *
 * Used when provisioning fails after the spreadsheet exists, so a half-created
 * install does not stay in the user's Drive. Never throws: cleanup failure must
 * not mask the original provisioning error, and must not leak Google error
 * details to the browser. Failures are logged for support instead.
 */
export async function trashGoogleDriveFile(
  fetchImpl: FetchLike,
  accessToken: string,
  fileId: string,
  context: GoogleCallContext,
): Promise<GoogleCleanupResult> {
  try {
    await googleJsonRequest<undefined>(fetchImpl, {
      url: `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}`,
      accessToken,
      operation: "drive.files.delete",
      correlationId: context.correlationId,
      method: "DELETE",
    });
    return { ok: true };
  } catch (error) {
    const status = error instanceof GoogleError ? error.status : null;
    const code = error instanceof GoogleError ? error.code : null;
    const reason = error instanceof Error ? error.message : "Unknown cleanup failure.";
    logGoogleEvent({
      correlationId: context.correlationId,
      event: "google_cleanup_failed",
      level: "error",
      operation: "drive.files.delete",
      status,
      googleCode: code,
      reason,
      detail:
        "A partially created Spreadsheet could not be moved to trash. The user may find an incomplete install in their Drive.",
    });
    return { ok: false, status, code, reason };
  }
}
