export const GOOGLE_OAUTH_COOKIE_SECRET_MIN_LENGTH = 32;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  cookieSecret: string;
};

export type GoogleOAuthEnv = Record<string, string | undefined>;

/**
 * Read the signing secret for the short-lived Google flow cookies.
 * Returns null when unset or too short, so the flow fails closed.
 */
export function resolveGoogleCookieSecret(env: GoogleOAuthEnv): string | null {
  const cookieSecret = env.GOOGLE_OAUTH_COOKIE_SECRET?.trim();
  if (!cookieSecret || cookieSecret.length < GOOGLE_OAUTH_COOKIE_SECRET_MIN_LENGTH) return null;
  return cookieSecret;
}

/**
 * Read and validate the server-only Google OAuth configuration.
 *
 * The client secret signs the Permudah calling application. The cookie secret
 * signs the short-lived, user-bound OAuth transaction and result cookies; it
 * is never sent to Google. Both are required: no default or invented value is
 * ever used, so a missing variable fails closed.
 *
 * The redirect URI must be configured explicitly in production so a spoofed
 * Host header can never influence the OAuth redirect.
 */
export function resolveGoogleOAuthConfig(
  env: GoogleOAuthEnv,
  options: { origin: string; isProduction: boolean },
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const cookieSecret = resolveGoogleCookieSecret(env);
  if (!clientId || !clientSecret || !cookieSecret) return null;

  const configuredRedirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (options.isProduction) {
    if (!configuredRedirectUri) return null;
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(configuredRedirectUri);
    } catch {
      return null;
    }
    if (redirectUrl.protocol !== "https:") return null;
    return { clientId, clientSecret, cookieSecret, redirectUri: configuredRedirectUri };
  }

  return {
    clientId,
    clientSecret,
    cookieSecret,
    redirectUri: configuredRedirectUri ?? `${options.origin}/api/google/callback`,
  };
}
