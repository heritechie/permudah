import {
  base64UrlDecodeJson,
  base64UrlEncodeJson,
  signValue,
  verifySignedValue,
} from "@/lib/google/crypto";

export const GOOGLE_OAUTH_TRANSACTION_PURPOSE = "permudah:google-oauth-transaction:v1";

const MAX_CLOCK_SKEW_MS = 60_000;

export type GoogleOAuthTransaction = {
  state: string;
  codeVerifier: string;
  userId: string;
  issuedAt: number;
};

export async function signGoogleOAuthTransaction(
  secret: string,
  input: { state: string; codeVerifier: string; userId: string; now?: number },
): Promise<string> {
  const payload: GoogleOAuthTransaction = {
    state: input.state,
    codeVerifier: input.codeVerifier,
    userId: input.userId,
    issuedAt: input.now ?? Date.now(),
  };
  return signValue(secret, GOOGLE_OAUTH_TRANSACTION_PURPOSE, base64UrlEncodeJson(payload));
}

export async function readGoogleOAuthTransaction(
  secret: string,
  token: string,
  options: { now?: number; ttlMs: number },
): Promise<GoogleOAuthTransaction | null> {
  const value = await verifySignedValue(secret, GOOGLE_OAUTH_TRANSACTION_PURPOSE, token);
  if (!value) return null;

  const parsed = base64UrlDecodeJson(value) as Partial<GoogleOAuthTransaction> | null;
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.state !== "string" || parsed.state.length === 0) return null;
  if (typeof parsed.codeVerifier !== "string" || parsed.codeVerifier.length === 0) return null;
  if (typeof parsed.userId !== "string" || parsed.userId.length === 0) return null;
  if (typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt)) return null;

  const now = options.now ?? Date.now();
  if (parsed.issuedAt > now + MAX_CLOCK_SKEW_MS) return null;
  if (now - parsed.issuedAt > options.ttlMs) return null;

  return {
    state: parsed.state,
    codeVerifier: parsed.codeVerifier,
    userId: parsed.userId,
    issuedAt: parsed.issuedAt,
  };
}
