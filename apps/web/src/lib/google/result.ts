import { isGoogleSpreadsheetUrl, isGoogleWebAppUrl } from "@/lib/google/urls";
import { base64UrlDecodeJson, base64UrlEncodeJson, signValue, verifySignedValue } from "@/lib/google/crypto";

export const GOOGLE_RESULT_PURPOSE = "permudah:google-web-app-result:v1";

const MAX_CLOCK_SKEW_MS = 60_000;

export type WebAppResultReference = {
  appName: string;
  ownerEmail: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  scriptId: string;
  webAppUrl: string;
  userId: string;
  issuedAt: number;
};

export async function signWebAppResult(
  secret: string,
  input: {
    appName: string;
    ownerEmail: string;
    spreadsheetId: string;
    spreadsheetUrl: string;
    scriptId: string;
    webAppUrl: string;
    userId: string;
    now?: number;
  },
): Promise<string> {
  const payload: WebAppResultReference = {
    appName: input.appName,
    ownerEmail: input.ownerEmail,
    spreadsheetId: input.spreadsheetId,
    spreadsheetUrl: input.spreadsheetUrl,
    scriptId: input.scriptId,
    webAppUrl: input.webAppUrl,
    userId: input.userId,
    issuedAt: input.now ?? Date.now(),
  };
  return signValue(secret, GOOGLE_RESULT_PURPOSE, base64UrlEncodeJson(payload));
}

export async function readWebAppResult(
  secret: string,
  token: string,
  options: { now?: number; ttlMs: number },
): Promise<WebAppResultReference | null> {
  const value = await verifySignedValue(secret, GOOGLE_RESULT_PURPOSE, token);
  if (!value) return null;

  const parsed = base64UrlDecodeJson(value) as Partial<WebAppResultReference> | null;
  if (!parsed || typeof parsed !== "object") return null;

  const requiredStrings = [
    "appName",
    "ownerEmail",
    "spreadsheetId",
    "spreadsheetUrl",
    "scriptId",
    "webAppUrl",
    "userId",
  ] as const;
  for (const key of requiredStrings) {
    const field = parsed[key];
    if (typeof field !== "string" || field.length === 0) return null;
  }
  if (typeof parsed.issuedAt !== "number" || !Number.isFinite(parsed.issuedAt)) return null;

  const now = options.now ?? Date.now();
  if (parsed.issuedAt > now + MAX_CLOCK_SKEW_MS) return null;
  if (now - parsed.issuedAt > options.ttlMs) return null;

  if (!isGoogleWebAppUrl(parsed.webAppUrl as string)) return null;
  if (!isGoogleSpreadsheetUrl(parsed.spreadsheetUrl as string)) return null;

  return parsed as WebAppResultReference;
}
