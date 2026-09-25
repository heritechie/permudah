export const GOOGLE_OAUTH_TRANSACTION_COOKIE = "permudah_google_oauth_txn";
export const GOOGLE_RESULT_COOKIE = "permudah_google_result";

export const GOOGLE_FLOW_TRANSACTION_TTL_SECONDS = 10 * 60;
export const GOOGLE_FLOW_RESULT_TTL_SECONDS = 10 * 60;

export function googleFlowCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
