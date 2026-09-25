import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveGoogleOAuthConfig } from "@/lib/google/config";
import {
  GOOGLE_FLOW_RESULT_TTL_SECONDS,
  GOOGLE_FLOW_TRANSACTION_TTL_SECONDS,
  GOOGLE_OAUTH_TRANSACTION_COOKIE,
  GOOGLE_RESULT_COOKIE,
  googleFlowCookieOptions,
} from "@/lib/google/cookies";
import { GoogleError } from "@/lib/google/errors";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  hasAllGoogleScopes,
  statesMatch,
} from "@/lib/google/oauth";
import { readGoogleOAuthTransaction } from "@/lib/google/transaction";
import { signWebAppResult } from "@/lib/google/result";
import { createCorrelationId, logGoogleEvent } from "@/lib/google/logging";
import { recordProvisionedGoogleWebApp } from "@/lib/google/registry";
import { createUserOwnedWebApp, POC_WEB_APP_NAME } from "@/lib/google/web-app";
import { getAuthenticatedSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Final step of the Permudah -> Google flow.
 *
 * - Requires the same authenticated Permudah user that started the flow.
 * - Validates the HMAC-signed, short-lived, user-bound OAuth transaction
 *   cookie. That cookie is NOT server-side single-use in B1: it is cleared from
 *   the response on every outcome, but there is no durable consumed marker, so
 *   a replayed callback carrying the same value is re-validated rather than
 *   rejected. See "Known limitations" in docs/milestone-b1-google-web-app.md.
 * - Exchanges the code server-side and uses the access token for one
 *   provisioning run; the token is never persisted or returned.
 * - Redirects to a result page that reads a short-lived, signed, user-bound
 *   reference cookie. No tokens, emails, or resource ids go into the URL.
 *
 * The redirect always carries a fixed error code from a closed set, plus the
 * correlation id of this request. Raw Google error text is never placed in a
 * URL: it is sanitized into the server logs, where the correlation id makes a
 * failed run traceable.
 */
export async function GET(request: Request) {
  const correlationId = createCorrelationId();
  const url = new URL(request.url);
  const origin = url.origin;
  const config = resolveGoogleOAuthConfig(process.env, {
    origin,
    isProduction: process.env.NODE_ENV === "production",
  });

  /**
   * Failure redirect for anything before provisioning starts. It carries the
   * same closed-set error code and support reference as a provisioning failure,
   * so every redacted redirect is traceable to a log line.
   */
  function redirectToGooglePage(error: string, logReason?: string): NextResponse {
    if (logReason) {
      logGoogleEvent({
        correlationId,
        event: "google_flow_rejected",
        level: "error",
        reason: error,
        detail: logReason,
      });
    }
    const target = new URL(`/google?error=${encodeURIComponent(error)}`, origin);
    target.searchParams.set("ref", correlationId);
    return NextResponse.redirect(target);
  }

  /**
   * Failure redirect for a provisioning attempt. `ref` is this request's
   * correlation id so a user can quote it in support, and it is the only
   * identifier that crosses into the browser.
   *
   * Permudah's own Google Cloud project number is deliberately NOT sent to the
   * browser. It stays in the sanitized server log next to the same correlation
   * id, which is where an operator actually needs it. The user cannot act on it
   * — a Cloud-project fault is ours to fix — so putting it in a URL the user can
   * read and share only exposes our project layout.
   */
  function redirectProvisioningFailure(failure: {
    reason: string;
    correlationId: string;
    googleProjectNumber: string | null;
  }): NextResponse {
    const target = new URL(`/google?error=${encodeURIComponent(failure.reason)}`, origin);
    target.searchParams.set("ref", failure.correlationId);
    return NextResponse.redirect(target);
  }

  if (!config) {
    return redirectToGooglePage("missing_config");
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login?redirect=%2Fgoogle", origin));
  }

  const cookieStore = await cookies();
  const transactionCookie = cookieStore.get(GOOGLE_OAUTH_TRANSACTION_COOKIE)?.value ?? null;
  // Clear the transaction from the response before any validation outcome, so a
  // normal browser never sends it twice. This is NOT a durable consumed marker:
  // a replayed callback presenting the same value is re-validated, not rejected.
  cookieStore.delete(GOOGLE_OAUTH_TRANSACTION_COOKIE);

  if (url.searchParams.get("error")) {
    return redirectToGooglePage("denied");
  }

  const transaction = transactionCookie
    ? await readGoogleOAuthTransaction(config.cookieSecret, transactionCookie, {
        ttlMs: GOOGLE_FLOW_TRANSACTION_TTL_SECONDS * 1000,
      })
    : null;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !transaction ||
    transaction.userId !== session.user.id ||
    !code ||
    !statesMatch(transaction.state, state)
  ) {
    return redirectToGooglePage(
      "invalid_state",
      `transaction_present=${Boolean(transaction)} transaction_user_match=${
        transaction?.userId === session.user.id
      } code_present=${Boolean(code)} state_present=${Boolean(state)}`,
    );
  }

  let accessToken: string;
  try {
    const tokens = await exchangeGoogleAuthorizationCode(fetch, {
      code,
      codeVerifier: transaction.codeVerifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });

    if (!hasAllGoogleScopes(tokens.scope)) {
      return redirectToGooglePage("insufficient_scope");
    }
    accessToken = tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleError && error.kind === "forbidden") {
      return redirectToGooglePage(
        "client_misconfigured",
        "The Google token endpoint rejected this OAuth client's credentials.",
      );
    }
    // The code, verifier, and tokens must never reach the log; the kind and
    // the Google code are enough to diagnose the failure.
    return redirectToGooglePage(
      "token_exchange_failed",
      error instanceof GoogleError
        ? `token exchange failed: kind=${error.kind} googleCode=${error.code ?? "none"} status=${error.status ?? "none"}`
        : "token exchange failed with a non-Google error.",
    );
  }

  let ownerEmail: string;
  try {
    const userInfo = await fetchGoogleUserInfo(fetch, accessToken);
    if (!userInfo.emailVerified) {
      return redirectToGooglePage("unverified_email");
    }
    ownerEmail = userInfo.email;
  } catch {
    return redirectToGooglePage("userinfo_failed");
  }

  const result = await createUserOwnedWebApp(
    fetch,
    accessToken,
    {
      appName: POC_WEB_APP_NAME,
      ownerEmail,
    },
    correlationId,
  );

  if (!result.ok) {
    return redirectProvisioningFailure(result);
  }

  // Google provisioning fully succeeded. Record the install durably.
  // userId comes from the authenticated session, never from the request, and
  // the client is the session-scoped one, so the database re-derives the owner
  // from the caller's JWT. No elevated credential is involved.
  const record = await recordProvisionedGoogleWebApp(
    {
      userId: session.user.id,
      spreadsheetId: result.data.spreadsheetId,
      scriptId: result.data.scriptId,
      deploymentId: result.data.deploymentId,
      webAppUrl: result.data.webAppUrl,
      ownerEmail: result.data.ownerEmail,
      correlationId,
    },
    { client: session.supabase },
  );

  if (!record.ok) {
    // The user's Google resources exist and are theirs: never delete them
    // because Permudah could not write a database row.
    logGoogleEvent({
      correlationId,
      event: "google_provisioning_succeeded_registry_failed",
      level: "error",
      reason: record.reason,
      detail: record.detail,
      userId: session.user.id,
      spreadsheetId: result.data.spreadsheetId,
    });
    return redirectProvisioningFailure({
      reason: "registry_failed",
      correlationId,
      googleProjectNumber: null,
    });
  }

  const reference = await signWebAppResult(config.cookieSecret, {
    appName: result.data.appName,
    ownerEmail: result.data.ownerEmail,
    spreadsheetId: result.data.spreadsheetId,
    spreadsheetUrl: result.data.spreadsheetUrl,
    scriptId: result.data.scriptId,
    webAppUrl: result.data.webAppUrl,
    userId: session.user.id,
  });

  cookieStore.set(
    GOOGLE_RESULT_COOKIE,
    reference,
    googleFlowCookieOptions(GOOGLE_FLOW_RESULT_TTL_SECONDS),
  );

  return NextResponse.redirect(new URL("/google/result", origin));
}
