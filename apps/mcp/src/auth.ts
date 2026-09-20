import { createClient } from "@supabase/supabase-js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export type AuthenticatedUser = {
  userId: string;
};

export type OAuthProtectedResourceMetadata = {
  resource: string;
  authorization_servers?: string[];
  jwks_uri?: string;
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  resource_signing_alg_values_supported?: string[];
  resource_name?: string;
  resource_documentation?: string;
};

/**
 * Derive the Supabase Auth server base URL from the Supabase project URL.
 * Example: https://<ref>.supabase.co -> https://<ref>.supabase.co/auth/v1
 */
export function getSupabaseAuthServerUrl(supabaseUrl: string): string {
  const base = supabaseUrl.replace(/\/$/, "");
  return `${base}/auth/v1`;
}

/**
 * Build RFC 9728 OAuth protected resource metadata for the MCP endpoint.
 */
export function buildProtectedResourceMetadata(
  requestUrl: URL,
  env: Env,
): OAuthProtectedResourceMetadata {
  const authServerUrl = getSupabaseAuthServerUrl(env.SUPABASE_URL);
  return {
    resource: requestUrl.toString(),
    authorization_servers: [authServerUrl],
    jwks_uri: `${authServerUrl}/.well-known/jwks.json`,
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: ["ES256"],
    resource_name: "Permudah MCP",
    resource_documentation: "https://permudah.com",
  };
}

/**
 * Format protected resource metadata into a WWW-Authenticate Bearer challenge.
 */
export function formatWwwAuthenticateHeader(
  metadata: OAuthProtectedResourceMetadata,
): string {
  const asUrls = metadata.authorization_servers ?? [];
  const parts = [`Bearer realm="Permudah MCP"`];
  if (asUrls.length > 0) {
    parts.push(`authorization_server="${asUrls[0]}"`);
  }
  parts.push(`resource_metadata="${metadata.resource}"`);
  return parts.join(", ");
}

/**
 * Create a 401 Unauthorized response with OAuth protected resource metadata.
 */
export function createUnauthorizedResponse(
  metadata: OAuthProtectedResourceMetadata,
): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized", error_description: "Authentication required" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": formatWwwAuthenticateHeader(metadata),
      },
    },
  );
}

/**
 * Extract Bearer token from the Authorization header.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * Validate a Bearer access token using the Supabase Auth JWT verification
 * mechanism (asymmetric JWKS / ES256 via getClaims).
 *
 * Does NOT trust any identity from request arguments.
 */
export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<AuthenticatedUser | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  try {
    const { data, error } = await (
      supabase.auth as {
        getClaims: (
          jwt: string,
        ) => Promise<{
          data: { claims: { iss: string; aud: string | string[]; sub: string; exp: number } } | null;
          error: { message: string } | null;
        }>;
      }
    ).getClaims(token);

    if (error || !data) return null;

    const claims = data.claims;

    // Verify issuer matches the configured Supabase Auth server.
    const expectedIssuerPrefix = getSupabaseAuthServerUrl(env.SUPABASE_URL);
    if (!claims.iss.startsWith(expectedIssuerPrefix)) return null;

    // Verify audience is intended for authenticated users of this project.
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes("authenticated")) return null;

    // Verify subject exists.
    if (!claims.sub) return null;

    return { userId: claims.sub };
  } catch {
    return null;
  }
}
