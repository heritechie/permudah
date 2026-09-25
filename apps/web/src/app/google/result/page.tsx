import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveGoogleCookieSecret } from "@/lib/google/config";
import { GOOGLE_FLOW_RESULT_TTL_SECONDS, GOOGLE_RESULT_COOKIE } from "@/lib/google/cookies";
import { readWebAppResult } from "@/lib/google/result";
import { getAuthenticatedSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Web App Created — Permudah",
};

export default async function GoogleResultPage() {
  const session = await getAuthenticatedSession();
  if (!session) {
    redirect("/login?redirect=%2Fgoogle%2Fresult");
  }

  const cookieSecret = resolveGoogleCookieSecret(process.env);

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(GOOGLE_RESULT_COOKIE)?.value ?? null;
  const reference =
    cookieSecret && cookieValue
      ? await readWebAppResult(cookieSecret, cookieValue, {
          ttlMs: GOOGLE_FLOW_RESULT_TTL_SECONDS * 1000,
        })
      : null;

  // The signed reference is bound to this Permudah user; anything else is
  // treated as "no result" instead of being rendered from query parameters.
  const result = reference && reference.userId === session.user.id ? reference : null;

  if (!result) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            No web app to show
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            The result of a Google connection is only available for a few minutes, in the same
            browser session that authorized it.
          </p>
          <Link
            href="/google"
            className="mt-6 inline-block rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Connect Google
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
          Your web app is ready
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          Created in <strong>{result.ownerEmail}</strong>&apos;s Google account.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">{result.appName}</h2>
          <p className="mt-2 break-all text-sm text-zinc-500">{result.webAppUrl}</p>
          <a
            href={result.webAppUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Open your web app
          </a>
          <p className="mt-3 text-xs text-zinc-500">
            This deployment is owner-only for the POC: only {result.ownerEmail} can open it.
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">Owned by you</h2>
          <ul className="mt-3 space-y-3 text-sm text-slate-600">
            <li>
              <a
                href={result.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                Spreadsheet
              </a>
              <span className="block text-xs text-zinc-400">{result.spreadsheetId}</span>
            </li>
            <li>
              <span className="font-medium text-slate-700">Apps Script project</span>
              <span className="block text-xs text-zinc-400">{result.scriptId}</span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-zinc-500">
            These resources live in your Google Drive. Open the spreadsheet to find the Apps
            Script bound to it.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/google" className="font-medium text-blue-600 hover:text-blue-700">
            Build another web app
          </Link>
        </p>
      </div>
    </main>
  );
}
