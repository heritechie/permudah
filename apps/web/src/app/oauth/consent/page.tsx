import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OAuthConsentForm } from "@/components/oauth-consent-form";

export const metadata: Metadata = {
  title: "Authorize App — Permudah",
};

type ConsentPageProps = {
  searchParams: Promise<{ authorization_id?: string }>;
};

type OAuthAuthorizationClient = {
  name: string;
};

type OAuthAuthorizationDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: OAuthAuthorizationClient;
  user: { id: string; email: string };
  scope: string;
};

type OAuthRedirect = {
  redirect_url: string;
};

function isRedirect(details: OAuthAuthorizationDetails | OAuthRedirect | null): details is OAuthRedirect {
  return !!details && "redirect_url" in details;
}

export default async function OAuthConsentPage({ searchParams }: ConsentPageProps) {
  const { authorization_id: authorizationId } = await searchParams;

  if (!authorizationId) {
    redirect("/login?error=missing_authorization");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const currentUrl = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  }

  const response = await (
    supabase.auth.oauth as {
      getAuthorizationDetails: (
        id: string,
      ) => Promise<{ data: OAuthAuthorizationDetails | OAuthRedirect | null; error: { message: string } | null }>;
    }
  ).getAuthorizationDetails(authorizationId);

  if (response.error || !response.data) {
    redirect("/login?error=invalid_authorization");
  }

  const details = response.data;

  if (isRedirect(details)) {
    redirect(details.redirect_url);
  }

  const scopes = details.scope
    .split(" ")
    .map((s: string) => s.trim())
    .filter(Boolean);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="text-center text-2xl font-semibold tracking-tight text-slate-900">
          Authorize {details.client.name}
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          {details.client.name} wants to access your Permudah account.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-800">Requested permissions</h2>
          <ul className="mt-3 space-y-2">
            {scopes.map((scope: string) => (
              <li key={scope} className="flex items-start gap-2 text-sm text-slate-700">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" />
                <span className="capitalize">{scope.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>

          <OAuthConsentForm authorizationId={authorizationId} />
        </div>
      </div>
    </main>
  );
}
