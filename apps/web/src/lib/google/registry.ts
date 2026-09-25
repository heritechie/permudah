/**
 * Durable registry of Google Web Apps provisioned in a user's own Google
 * account.
 *
 * A row is written only after every Google provisioning step has succeeded.
 *
 * Privilege model: this module holds no elevated credential. It calls the
 * SECURITY DEFINER Postgres function `register_google_web_app` through the
 * ordinary RPC path using the *user's own* server-side Supabase client, so the
 * request is authenticated as `authenticated` and the database re-derives the
 * owner from the JWT with `auth.uid()`. A service-role key is deliberately not
 * used: it would bypass row level security on every table in the database, not
 * just this one.
 *
 * Nothing here stores a Google credential: no access token, no refresh token,
 * no authorization code.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logGoogleEvent } from "@/lib/google/logging";
import { isGoogleWebAppUrl } from "@/lib/google/urls";

export const GOOGLE_WEB_APP_STATUSES = ["active", "failed", "disabled"] as const;
export type GoogleWebAppStatus = (typeof GOOGLE_WEB_APP_STATUSES)[number];

export type GoogleWebAppInput = {
  /**
   * The Permudah user who owns the install. MUST be derived from the
   * authenticated server session, never from request input. The database
   * re-verifies it against the caller's JWT and rejects a mismatch.
   */
  userId: string;
  spreadsheetId: string;
  scriptId: string;
  deploymentId: string;
  webAppUrl: string;
  ownerEmail: string;
  correlationId: string;
};

export type RecordGoogleWebAppResult =
  | { ok: true; id: string; correlationId: string }
  | {
      ok: false;
      reason: "registry_not_configured" | "registry_write_failed";
      detail: string;
      correlationId: string;
    };

/** The only supported write path. Exposed by PostgREST as an RPC. */
const RPC_REGISTER = "register_google_web_app";

/** Longest value the database function accepts, mirrored for a fast local reject. */
const MAX_FIELD_LENGTH = 512;

/**
 * Record a successfully provisioned Google Web App.
 *
 * Never throws. A persistence failure is reported, never repaired by deleting
 * the user's Google resources: those exist in their account and are theirs.
 */
export async function recordProvisionedGoogleWebApp(
  input: GoogleWebAppInput,
  deps: { client?: SupabaseClient | null } = {},
): Promise<RecordGoogleWebAppResult> {
  const correlationId = input.correlationId;
  const client = deps.client ?? null;

  const reject = (reason: "registry_not_configured" | "registry_write_failed", detail: string) => {
    logGoogleEvent({
      correlationId,
      event: "google_registry_write_failed",
      level: "error",
      reason,
      detail,
    });
    return { ok: false, reason, detail, correlationId } as const;
  };

  if (!client) {
    logGoogleEvent({
      correlationId,
      event: "google_registry_unavailable",
      level: "error",
      reason: "registry_not_configured",
      detail:
        "Google provisioning succeeded but no authenticated Supabase client was provided, so the install could not be recorded.",
    });
    return {
      ok: false,
      reason: "registry_not_configured",
      // Never name an internal cause: this detail is logged and is meant to stay
      // safe to surface.
      detail: "No authenticated database client was available for the registry write.",
      correlationId,
    };
  }

  // Defence in depth: never store a URL that is not a Google Apps Script URL,
  // even though the provisioning flow already validated it.
  if (!isGoogleWebAppUrl(input.webAppUrl)) {
    return reject("registry_write_failed", "The deployment URL was not a Google Apps Script URL.");
  }

  const fields = [
    input.spreadsheetId,
    input.scriptId,
    input.deploymentId,
    input.webAppUrl,
    input.ownerEmail,
  ];
  if (
    fields.some((field) => typeof field !== "string" || field.trim() === "" || field.length > MAX_FIELD_LENGTH)
  ) {
    return reject("registry_write_failed", "A required registry value was empty or too long.");
  }

  const { data, error } = await client.rpc(RPC_REGISTER, {
    p_user_id: input.userId,
    p_spreadsheet_id: input.spreadsheetId,
    p_script_id: input.scriptId,
    p_deployment_id: input.deploymentId,
    p_web_app_url: input.webAppUrl,
    p_owner_email: input.ownerEmail,
    p_status: "active",
  });

  if (error || typeof data !== "string" || data.length === 0) {
    const message = error?.message ?? "The registry function returned no row id.";
    // 42501 is what the function raises when the caller does not match
    // p_user_id, and what a direct browser INSERT would hit without a policy.
    const identityRejected = error?.code === "42501" || /does not match the authenticated user/i.test(message);
    logGoogleEvent({
      correlationId,
      event: "google_registry_write_failed",
      level: "error",
      reason: "registry_write_failed",
      googleErrorKind: identityRejected ? "identity_rejected" : undefined,
      detail: identityRejected
        ? "The database rejected the owner id: it did not match the authenticated user."
        : message,
    });
    return {
      ok: false,
      reason: "registry_write_failed",
      // The reason is a fixed enum for the browser; the database message stays
      // in the server log.
      detail: "The registry write was rejected by the database.",
      correlationId,
    };
  }

  logGoogleEvent({
    correlationId,
    event: "google_registry_recorded",
    userId: input.userId,
  });

  return { ok: true, id: data, correlationId };
}
