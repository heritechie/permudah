import { describe, expect, test } from "vitest";
import {
  buildGoogleAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  GOOGLE_API_SCOPES,
  GOOGLE_OAUTH_SCOPES,
  GOOGLE_SCOPE_RATIONALE,
  GOOGLE_SCOPES_STRING,
  hasAllGoogleScopes,
  statesMatch,
} from "@/lib/google/oauth";
import { GoogleError } from "@/lib/google/errors";
import { fakeGoogleFetch } from "@/lib/google/test-utils";

describe("Google OAuth scopes", () => {
  test("requests exactly the scopes the flow needs", () => {
    expect(GOOGLE_OAUTH_SCOPES).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
    ]);
  });

  test("never requests a broad or restricted Drive scope", () => {
    expect(GOOGLE_SCOPES_STRING).not.toContain("auth/drive ");
    expect(GOOGLE_SCOPES_STRING).not.toContain("auth/spreadsheets");
  });

  test("documents why each scope is required", () => {
    for (const scope of GOOGLE_OAUTH_SCOPES) {
      expect(GOOGLE_SCOPE_RATIONALE[scope]).toBeTruthy();
    }
  });

  test("scope string joins scopes with spaces", () => {
    expect(GOOGLE_SCOPES_STRING).toBe(GOOGLE_OAUTH_SCOPES.join(" "));
  });

  test("separates the API resource scopes from the identity scopes", () => {
    expect(GOOGLE_API_SCOPES).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
    ]);
    // Identity scopes stay in the request but are never read from token.scope.
    expect(GOOGLE_API_SCOPES).not.toContain("openid");
    expect(GOOGLE_API_SCOPES).not.toContain("email");
  });

  test("hasAllGoogleScopes accepts the granted API scopes without identity scopes", () => {
    // Exactly what Google returns: resource scopes, no openid/email.
    expect(
      hasAllGoogleScopes(
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments",
      ),
    ).toBe(true);
  });

  test("hasAllGoogleScopes accepts extra granted scopes, including identity scopes", () => {
    expect(hasAllGoogleScopes(GOOGLE_SCOPES_STRING)).toBe(true);
    expect(hasAllGoogleScopes(`openid email ${GOOGLE_SCOPES_STRING}`)).toBe(true);
    // A superset grant (for example an extra previously granted scope) is fine.
    expect(hasAllGoogleScopes(`${GOOGLE_API_SCOPES.join(" ")} https://www.googleapis.com/auth/drive.readonly`)).toBe(
      true,
    );
  });

  test("hasAllGoogleScopes tolerates tabs and repeated whitespace", () => {
    expect(hasAllGoogleScopes(`${GOOGLE_API_SCOPES.join("  ")}\t`)).toBe(true);
  });

  test("hasAllGoogleScopes treats an absent scope field as granted == requested", () => {
    // OAuth allows omitting scope when the grant matches the request.
    expect(hasAllGoogleScopes(undefined)).toBe(true);
    expect(hasAllGoogleScopes(null)).toBe(true);
    expect(hasAllGoogleScopes("")).toBe(true);
    expect(hasAllGoogleScopes("   ")).toBe(true);
  });

  test("hasAllGoogleScopes rejects a genuinely missing API scope", () => {
    expect(
      hasAllGoogleScopes(
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.projects",
      ),
    ).toBe(false);
    expect(
      hasAllGoogleScopes(
        "https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments",
      ),
    ).toBe(false);
  });

  test("hasAllGoogleScopes does not match scopes by prefix or substring", () => {
    // A near-miss scope name is a missing scope, not a match.
    expect(
      hasAllGoogleScopes(
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/script.project https://www.googleapis.com/auth/script.deployments",
      ),
    ).toBe(false);
    expect(
      hasAllGoogleScopes(
        "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/script.deployments",
      ),
    ).toBe(false);
  });
});

describe("Google OAuth state", () => {
  test("createOAuthState produces a long random url-safe value", () => {
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9\-_]{40,60}$/);
  });

  test("two states differ", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
  });

  test("statesMatch returns true for equal and false for different", () => {
    const state = createOAuthState();
    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, "different-value")).toBe(false);
    expect(statesMatch(state, `${state}x`)).toBe(false);
    expect(statesMatch(null, state)).toBe(false);
    expect(statesMatch(state, null)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
  });
});

describe("PKCE", () => {
  test("challenge is S256 of the verifier", async () => {
    const { verifier, challenge } = await createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    const canonical = new TextEncoder().encode(verifier);
    const digestBytes = await crypto.subtle.digest("SHA-256", canonical);
    const digestB64 = btoa(String.fromCharCode(...new Uint8Array(digestBytes)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(challenge).toBe(digestB64);
  });

  test("each pair uses a fresh verifier", async () => {
    const first = await createPkcePair();
    const second = await createPkcePair();
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("buildGoogleAuthorizationUrl", () => {
  test("builds a consent URL with online access, state, PKCE, and scope", () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: "client-123.apps.googleusercontent.com",
      redirectUri: "https://permudah.com/api/google/callback",
      state: "state-abc",
      codeChallenge: "challenge-xyz",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://accounts.google.com");
    expect(parsed.pathname).toBe("/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("client-123.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://permudah.com/api/google/callback",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(GOOGLE_SCOPES_STRING);
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    // Online access: Google issues no refresh token for this POC flow.
    expect(parsed.searchParams.get("access_type")).toBe("online");
  });

  test("never places a client secret or access token in the authorization URL", () => {
    const url = buildGoogleAuthorizationUrl({
      clientId: "c",
      redirectUri: "https://x/callback",
      state: "s",
      codeChallenge: "ch",
    });
    expect(url).not.toContain("client_secret");
    expect(url).not.toContain("ya29.");
  });
});

describe("exchangeGoogleAuthorizationCode", () => {
  const params = {
    code: "code-123",
    codeVerifier: "verifier-123",
    clientId: "client-123",
    clientSecret: "secret-123",
    redirectUri: "https://permudah.com/api/google/callback",
  };

  test("exchanges code for an access token", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "oauth2.googleapis.com/token": {
        body: {
          access_token: "ya29.secret-token",
          token_type: "Bearer",
          expires_in: 3600,
          // Realistic: Google reports resource scopes, not openid/email.
          scope: GOOGLE_API_SCOPES.join(" "),
        },
      },
    });

    const tokens = await exchangeGoogleAuthorizationCode(fetchImpl, params);

    expect(tokens.accessToken).toBe("ya29.secret-token");
    expect(tokens.expiresInSeconds).toBe(3600);
    expect(tokens.scope).toBe(GOOGLE_API_SCOPES.join(" "));
    expect(hasAllGoogleScopes(tokens.scope)).toBe(true);

    const call = calls.find((c) => c.url.includes("oauth2.googleapis.com/token"))!;
    const body = new URLSearchParams(call.init?.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-123");
    expect(body.get("code_verifier")).toBe("verifier-123");
    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("client_secret")).toBe("secret-123");
    expect(body.get("redirect_uri")).toBe("https://permudah.com/api/google/callback");
  });

  test("keeps an omitted scope field usable as granted == requested", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "oauth2.googleapis.com/token": {
        body: { access_token: "ya29.secret-token", token_type: "Bearer", expires_in: 3600 },
      },
    });

    const tokens = await exchangeGoogleAuthorizationCode(fetchImpl, params);

    expect(tokens.scope).toBe("");
    expect(hasAllGoogleScopes(tokens.scope)).toBe(true);
  });

  test("never retains a refresh token even if Google returns one", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "oauth2.googleapis.com/token": {
        body: {
          access_token: "ya29.secret-token",
          refresh_token: "1//refresh-token-should-be-dropped",
          token_type: "Bearer",
          expires_in: 3600,
          scope: GOOGLE_API_SCOPES.join(" "),
        },
      },
    });

    const tokens = await exchangeGoogleAuthorizationCode(fetchImpl, params);

    expect(JSON.stringify(tokens)).not.toContain("refresh-token-should-be-dropped");
    expect(Object.keys(tokens)).not.toContain("refreshToken");
  });

  test("throws invalid_grant on rejected code", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "oauth2.googleapis.com/token": {
        status: 400,
        body: { error: "invalid_grant", error_description: "Bad code" },
      },
    });

    await expect(exchangeGoogleAuthorizationCode(fetchImpl, params)).rejects.toMatchObject({
      kind: "invalid_grant",
    });
  });

  test("failure does not leak the client secret or the code", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "oauth2.googleapis.com/token": {
        status: 400,
        body: { error: "invalid_grant", error_description: "Bad code" },
      },
    });

    try {
      await exchangeGoogleAuthorizationCode(fetchImpl, params);
      throw new Error("expected rejection");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("secret-123");
      expect(message).not.toContain("code-123");
    }
  });

  test("throws on network failure without leaking secrets", async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error("boom");
    };
    await expect(exchangeGoogleAuthorizationCode(fetchImpl, params)).rejects.toBeInstanceOf(
      GoogleError,
    );
  });
});

describe("fetchGoogleUserInfo", () => {
  test("returns email for an authorized token", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "openidconnect.googleapis.com/v1/userinfo": {
        body: { sub: "sub-1", email: "user@example.com", email_verified: true },
      },
    });

    const info = await fetchGoogleUserInfo(fetchImpl, "token-ok");
    expect(info.email).toBe("user@example.com");
    expect(info.sub).toBe("sub-1");
    expect(info.emailVerified).toBe(true);
  });

  test("throws unauthorized on invalid or expired token", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "openidconnect.googleapis.com/v1/userinfo": { status: 401, body: {} },
    });

    await expect(fetchGoogleUserInfo(fetchImpl, "token-bad")).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  test("does not include the token in the error message", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "openidconnect.googleapis.com/v1/userinfo": { status: 401, body: {} },
    });

    try {
      await fetchGoogleUserInfo(fetchImpl, "secret-token-value");
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-token-value");
    }
  });
});
