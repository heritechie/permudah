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
  service_disabled:
    "The Google API Permudah needs is not enabled yet. Nothing was created and nothing was deleted in your Google account.",
  not_found: "The Google resource could not be found.",
  rate_limited: "Google is rate-limiting requests. Please try again shortly.",
  missing_web_app_url: "The Web App was deployed but Google returned no URL.",
  google_api_error: "A Google API error occurred. Please try again.",
  registry_failed:
    "Your web app was created in your Google account, but Permudah could not save a record of it. Nothing was deleted — the app is still in your Drive.",
};

/** A Google Cloud project number is digits only; nothing else is rendered. */
function safeProjectNumber(value: string | undefined): string | null {
  return value && /^\d{6,20}$/.test(value) ? value : null;
}

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
  const error = params.error ? (ERROR_MESSAGES[params.error] ?? "The Google connection failed.") : null;
  const projectNumber = safeProjectNumber(params.project);
  const reference = safeReference(params.ref);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
          Build a Web App
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Free Official Workflow — create a web app that lives in your own Google account.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <p>{error}</p>
            {params.error === "service_disabled" && projectNumber ? (
              <p className="mt-2">
                Enable the Google Drive API and the Apps Script API for Google Cloud project{" "}
                <span className="font-mono">{projectNumber}</span>, then try again.
              </p>
            ) : null}
            {reference ? (
              <p className="mt-2 text-xs text-red-600">
                Reference for support: <span className="font-mono">{reference}</span>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">What happens</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" />
              Permudah asks for your permission to connect your Google account
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" />
              A spreadsheet, Apps Script project, and web app are created in
              <strong> your</strong> Google Drive
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" />
              You keep the resulting app URL — Permudah never hosts it
            </li>
          </ul>

          <Link
            href="/api/google/auth"
            className="mt-6 block rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Connect Google
          </Link>
          <p className="mt-3 text-xs text-zinc-500">
            You will be sent to Google to approve access. Permudah requests only the permissions
            needed to create the spreadsheet, the script project, and the deployment in your
            account. No Google token is stored by Permudah.
          </p>
        </div>
      </div>
    </main>
  );
}
