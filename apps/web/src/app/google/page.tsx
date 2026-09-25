import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Connect Google — Permudah",
};

type GooglePageProps = {
  searchParams: Promise<{ error?: string; ref?: string; project?: string }>;
};

/**
 * Google's own Apps Script settings page. It is a constant, not user input: the
 * page must never render a link built from the query string.
 */
const APPS_SCRIPT_SETTINGS_URL = "https://script.google.com/home/usersettings";

/**
 * The single Google entry point. "Try again" deliberately points here rather
 * than at the callback: this route mints a fresh OAuth state, a fresh PKCE
 * verifier, and a fresh transaction cookie. Nothing from the previous attempt is
 * reused, and its access token lived only in the failed request's memory, so a
 * retry is always a brand new authorization round trip.
 */
const CONNECT_GOOGLE_PATH = "/api/google/auth";

const ERROR_MESSAGES: Record<string, string> = {
  missing_config: "Permudah Google integration is not configured yet.",
  client_misconfigured: "The Permudah Google OAuth client was rejected by Google.",
  denied: "You did not authorize Permudah to access your Google account.",
  invalid_state: "The Google authorization request could not be verified. Please try again.",
  insufficient_scope:
    "The requested Google permissions were not fully granted. Please grant all requested permissions.",
  unverified_email: "Your Google account email is not verified, so the account cannot be used yet.",
  token_exchange_failed: "Google could not exchange the authorization code.",
  userinfo_failed: "Could not read your Google account profile.",
  ownership_mismatch:
    "The Google account that owns the created file did not match the authorized account.",
  unauthorized: "Your Google access expired or is invalid. Please connect again.",
  forbidden: "Permudah does not have permission for this action on your Google account.",
  /**
   * Permudah's own Google Cloud project does not have the Apps Script API
   * enabled. The user cannot fix this and is not asked to: it is an operator
   * configuration fault, and the Google error stays in the server logs where the
   * correlation id can find it.
   */
  service_disabled:
    "Permudah has a configuration problem on our side, so your app could not be built. Nothing was created and nothing was deleted in your Google account. Please contact support and include the reference below.",
  not_found: "The Google resource could not be found.",
  rate_limited: "Google is rate-limiting requests. Please try again shortly.",
  missing_web_app_url: "The Web App was deployed but Google returned no URL.",
  google_api_error: "A Google API error occurred. Please try again.",
  registry_failed:
    "Your web app was created in your Google account, but Permudah could not save a record of it. Nothing was deleted — the app is still in your Drive.",
};

/**
 * Reasons where the fix is a per-user Google setting the account holder can
 * complete. Google calls this granting third-party applications Apps Script API
 * access to their script projects.
 *
 * This is deliberately NOT the same state as `service_disabled`, which is a
 * fault in Permudah's own Cloud project and is therefore not actionable by the
 * end user. Both are classified server-side; this page only switches on the
 * closed set of literal reason codes and never re-derives the diagnosis from raw
 * Google text.
 */
const USER_ACCESS_REQUIRED_REASONS = new Set(["apps_script_access_required"]);

/** The correlation id is a random base64url token; keep only a safe shape. */
function safeReference(value: string | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

export default async function GooglePage({ searchParams }: GooglePageProps) {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login?redirect=%2Fgoogle");
  }

  const params = await searchParams;
  // The user-access state has its own dedicated card, so it is not in
  // ERROR_MESSAGES. Both switches test a closed set of literal strings, so a
  // hostile ?error= value can only ever fall through to the generic fallback and
  // can never select different copy.
  const userAccessRequired =
    params.error !== undefined && USER_ACCESS_REQUIRED_REASONS.has(params.error);
  const error =
    params.error && !userAccessRequired
      ? (ERROR_MESSAGES[params.error] ?? "The Google connection failed.")
      : null;
  const reference = safeReference(params.ref);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
            Build a Web App
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            Free Official Workflow — create a web app that lives in your own Google account.
          </p>
        </div>

        {userAccessRequired ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-amber-900">Allow Apps Script access</h2>
            <p className="mt-2 text-sm text-amber-900">
              Before Permudah can create and manage an Apps Script project in your Google account,
              Google requires you to allow Apps Script API access to your script projects. You only
              need to do this once. Nothing was created and nothing was deleted.
            </p>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <a
                href={APPS_SCRIPT_SETTINGS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center rounded-lg border border-amber-400 bg-white px-4 py-2.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Open Apps Script settings
              </a>
              <Link
                href={CONNECT_GOOGLE_PATH}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-700"
              >
                Try again
              </Link>
            </div>
            <p className="mt-3 text-xs text-amber-800">
              After enabling it, return here and try again.
            </p>
            {reference ? (
              <p className="mt-3 text-xs text-amber-800">
                Reference for support: <span className="font-mono">{reference}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <p>{error}</p>
            {reference ? (
              <p className="mt-2 text-xs text-red-600">
                Reference for support: <span className="font-mono">{reference}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">What you&apos;ll get</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
              A spreadsheet created in your Google Drive
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
              An Apps Script project bound to that spreadsheet
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
              A web app deployed from your Apps Script project, executable by you only
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
              You&apos;ll keep ownership of every one of those resources — Permudah never hosts
              the app
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">Google setup</h2>
          <p className="mt-2 text-sm text-slate-600">
            Before Permudah can build your app, Google requires you to allow Apps Script API access
            to your script projects in the Google account you connect. You only need to do this
            once.
          </p>
          <a
            href={APPS_SCRIPT_SETTINGS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Open Apps Script settings
          </a>
          <p className="mt-3 text-xs text-zinc-500">
            After enabling it, return here and continue.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">Connect your account</h2>
          <p className="mt-2 text-sm text-slate-600">
            Permudah asks for permission to create the resources above. You will be sent to Google
            to approve access, and only the permissions needed to create them are requested. No
            Google token is stored by Permudah.
          </p>
          <Link
            href={CONNECT_GOOGLE_PATH}
            className="mt-4 block rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Connect Google
          </Link>
        </section>
      </div>
    </main>
  );
}
