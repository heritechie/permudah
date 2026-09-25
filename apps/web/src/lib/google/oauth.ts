/**
 * Google OAuth 2.0 (authorization code flow) for Permudah -> Google.
 *
 * This boundary is distinct from the ChatGPT -> Permudah OAuth boundary.
 * Here the USER authorizes Permudah to act inside the USER's own Google
 * account. The access token is held in a single request handler, in memory,
 * and is never persisted, logged, or returned to a browser.
 *
 * `access_type=online` is deliberate for the POC: Google issues a short-lived
 * access token and no refresh token, so there is no long-lived Google secret
 * for Permudah to store. Ongoing operations (redeploy, update) later require
 * offline access plus encrypted refresh-token storage, which is out of scope.
 */

import { GoogleError } from "@/lib/google/errors";
import { createRandomToken, sha256Base64Url, timingSafeStringEqual } from "@/lib/google/crypto";
import type { FetchLike } from "@/lib/google/http";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
] as const;

export const GOOGLE_SCOPES_STRING = GOOGLE_OAUTH_SCOPES.join(" ");

/**
 * The resource scopes that must be verifiable in the token response.
 *
 * `openid` and `email` are deliberately excluded: they authorize an ID token,
 * not API access, so Google does not report them in the token response `scope`
 * field. They stay in the authorization request and are proven by the userinfo
 * call instead.
 */
export const GOOGLE_API_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
] as const;

export const GOOGLE_SCOPE_RATIONALE: Record<(typeof GOOGLE_OAUTH_SCOPES)[number], string> = {
  openid: "OIDC ID token so the callback can read the Google account subject that the token belongs to.",
  email: "Read the connected Google account email to prove the resources are created in the user's own account.",
  "https://www.googleapis.com/auth/drive.file": "Create the Spreadsheet in the user's Drive and read its owner. Limited to files this app creates.",
  "https://www.googleapis.com/auth/script.projects": "Create the Apps Script project, replace its content, and create a version snapshot.",
  "https://www.googleapis.com/auth/script.deployments": "Create the Web App deployment for the user's script project.",
};

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

const STATE_BYTES = 32;
const VERIFIER_BYTES = 32;

export type GoogleOAuthTokens = {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
  scope: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  emailVerified: boolean;
};

export function createOAuthState(): string {
  return createRandomToken(STATE_BYTES);
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = createRandomToken(VERIFIER_BYTES);
  return { verifier, challenge: await sha256Base64Url(verifier) };
}

export function statesMatch(
  expected: string | null | undefined,
  received: string | null | undefined,
): boolean {
  if (!expected || !received) return false;
  return timingSafeStringEqual(expected, received);
}

export type GoogleAuthorizationUrlParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce?: string;
};

export function buildGoogleAuthorizationUrl(params: GoogleAuthorizationUrlParams): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES_STRING);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.nonce) {
    url.searchParams.set("nonce", params.nonce);
  }
  return url.toString();
}

export type ExchangeAuthorizationCodeParams = {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export async function exchangeGoogleAuthorizationCode(
  fetchImpl: FetchLike,
  params: ExchangeAuthorizationCodeParams,
): Promise<GoogleOAuthTokens> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    throw new GoogleError("google_api_error", "Failed to reach Google OAuth token endpoint.");
  }

  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    json = null;
  }

  if (!response.ok || !json) {
    const rawError = json?.error;
    const kind =
      rawError === "invalid_grant"
        ? "invalid_grant"
        : rawError === "invalid_client"
          ? "forbidden"
          : "google_api_error";
    throw new GoogleError(kind, "Google OAuth token exchange failed.", response.status);
  }

  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new GoogleError("google_api_error", "Google OAuth token response had no access token.");
  }

  // `refresh_token` is intentionally never read: with access_type=online
  // Google does not return one, and Permudah must not retain one if it does.
  const grantedScope = typeof json.scope === "string" ? json.scope : "";
  return {
    accessToken,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : 3600,
    scope: grantedScope,
  };
}

/**
 * Decide whether the access token is usable for provisioning.
 *
 * Only the API resource scopes are checked, as exact strings. An absent or
 * empty `scope` field means Google granted exactly what was requested, so it is
 * not a failure. Identity (`openid`, `email`) is verified by the userinfo call,
 * never by this check.
 */
export function hasAllGoogleScopes(grantedScope: string | null | undefined): boolean {
  const granted = (grantedScope ?? "").split(/\s+/).filter(Boolean);
  if (granted.length === 0) return true;
  return GOOGLE_API_SCOPES.every((scope) => granted.includes(scope));
}

export async function fetchGoogleUserInfo(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<GoogleUserInfo> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new GoogleError("google_api_error", "Failed to reach Google userinfo endpoint.");
  }

  if (!response.ok) {
    throw new GoogleError(
      "unauthorized",
      "Google userinfo call failed with an invalid or expired access token.",
      response.status,
    );
  }

  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") json = parsed as Record<string, unknown>;
  } catch {
    json = null;
  }

  const sub = json?.sub;
  const email = json?.email;
  if (typeof sub !== "string" || typeof email !== "string") {
    throw new GoogleError(
      "google_api_error",
      "Google userinfo response was missing the expected identity fields.",
    );
  }

  return {
    sub,
    email,
    emailVerified: json?.email_verified === true || json?.email_verified === "true",
  };
}
