import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveGoogleOAuthConfig } from "@/lib/google/config";
import {
  GOOGLE_FLOW_TRANSACTION_TTL_SECONDS,
  GOOGLE_OAUTH_TRANSACTION_COOKIE,
  googleFlowCookieOptions,
} from "@/lib/google/cookies";
import { buildGoogleAuthorizationUrl, createOAuthState, createPkcePair } from "@/lib/google/oauth";
import { signGoogleOAuthTransaction } from "@/lib/google/transaction";
import { getAuthenticatedSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Start the Permudah -> Google authorization code flow.
 *
 * Requires an authenticated Permudah session. The OAuth state, PKCE verifier,
 * and the Permudah user id are stored in one HMAC-signed, HttpOnly, short-lived
 * cookie so the callback can bind the Google account to a signed-in Permudah
 * user. No Google token exists yet at this point.
 */
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const config = resolveGoogleOAuthConfig(process.env, {
    origin,
    isProduction: process.env.NODE_ENV === "production",
  });

  if (!config) {
    return NextResponse.rewrite(new URL("/google?error=missing_config", origin));
  }

  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login?redirect=%2Fgoogle", origin));
  }

  const state = createOAuthState();
  const pkce = await createPkcePair();
  const transaction = await signGoogleOAuthTransaction(config.cookieSecret, {
    state,
    codeVerifier: pkce.verifier,
    userId: session.user.id,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    GOOGLE_OAUTH_TRANSACTION_COOKIE,
    transaction,
    googleFlowCookieOptions(GOOGLE_FLOW_TRANSACTION_TTL_SECONDS),
  );

  return NextResponse.redirect(
    buildGoogleAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge: pkce.challenge,
    }),
  );
}
