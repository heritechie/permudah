import { describe, expect, test } from "vitest";
import {
  GOOGLE_OAUTH_COOKIE_SECRET_MIN_LENGTH,
  resolveGoogleCookieSecret,
  resolveGoogleOAuthConfig,
} from "@/lib/google/config";

const FULL_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "client-123",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://permudah.com/api/google/callback",
  GOOGLE_OAUTH_COOKIE_SECRET: "x".repeat(GOOGLE_OAUTH_COOKIE_SECRET_MIN_LENGTH),
};

const origin = "https://permudah.com";

describe("resolveGoogleOAuthConfig", () => {
  test("returns the full configuration when every variable is present", () => {
    expect(resolveGoogleOAuthConfig(FULL_ENV, { origin, isProduction: true })).toEqual({
      clientId: FULL_ENV.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: FULL_ENV.GOOGLE_OAUTH_CLIENT_SECRET,
      cookieSecret: FULL_ENV.GOOGLE_OAUTH_COOKIE_SECRET,
      redirectUri: FULL_ENV.GOOGLE_OAUTH_REDIRECT_URI,
    });
  });

  test("fails closed when the client id is missing", () => {
    const env = { ...FULL_ENV, GOOGLE_OAUTH_CLIENT_ID: "" };
    expect(resolveGoogleOAuthConfig(env, { origin, isProduction: true })).toBeNull();
  });

  test("fails closed when the client secret is missing", () => {
    const env = { ...FULL_ENV, GOOGLE_OAUTH_CLIENT_SECRET: undefined };
    expect(resolveGoogleOAuthConfig(env, { origin, isProduction: true })).toBeNull();
  });

  test("fails closed when the cookie secret is missing or too short", () => {
    expect(
      resolveGoogleOAuthConfig({ ...FULL_ENV, GOOGLE_OAUTH_COOKIE_SECRET: undefined }, { origin, isProduction: true }),
    ).toBeNull();
    expect(
      resolveGoogleOAuthConfig({ ...FULL_ENV, GOOGLE_OAUTH_COOKIE_SECRET: "too-short" }, { origin, isProduction: true }),
    ).toBeNull();
  });

  test("never invents a default secret", () => {
    expect(resolveGoogleOAuthConfig({ ...FULL_ENV, GOOGLE_OAUTH_COOKIE_SECRET: undefined }, { origin, isProduction: true })).toBeNull();
  });

  test("requires an explicit https redirect uri in production", () => {
    const env = { ...FULL_ENV, GOOGLE_OAUTH_REDIRECT_URI: undefined };
    expect(resolveGoogleOAuthConfig(env, { origin, isProduction: true })).toBeNull();
    expect(
      resolveGoogleOAuthConfig(
        { ...FULL_ENV, GOOGLE_OAUTH_REDIRECT_URI: "http://permudah.com/api/google/callback" },
        { origin, isProduction: true },
      ),
    ).toBeNull();
  });

  test("falls back to the request origin outside production", () => {
    const env = { ...FULL_ENV, GOOGLE_OAUTH_REDIRECT_URI: undefined };
    expect(resolveGoogleOAuthConfig(env, { origin, isProduction: false })?.redirectUri).toBe(
      "https://permudah.com/api/google/callback",
    );
  });
});

describe("resolveGoogleCookieSecret", () => {
  test("returns a long enough secret", () => {
    expect(resolveGoogleCookieSecret(FULL_ENV)).toBe(FULL_ENV.GOOGLE_OAUTH_COOKIE_SECRET);
  });

  test("rejects a short secret", () => {
    expect(resolveGoogleCookieSecret({ GOOGLE_OAUTH_COOKIE_SECRET: "short" })).toBeNull();
  });
});
