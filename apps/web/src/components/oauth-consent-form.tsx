"use client";

import { useState, type FormEvent } from "react";
import { approveAuthorizationAction, denyAuthorizationAction } from "@/app/oauth/consent/actions";

type OAuthConsentFormProps = {
  authorizationId: string;
};

export function OAuthConsentForm({ authorizationId }: OAuthConsentFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleAllow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await approveAuthorizationAction(authorizationId);
    if (!result.ok) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    window.location.assign(result.redirect_url);
  }

  async function handleDeny(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await denyAuthorizationAction(authorizationId);
    if (!result.ok) {
      setError(result.error);
      setIsLoading(false);
      return;
    }

    window.location.assign(result.redirect_url);
  }

  return (
    <div className="mt-6 space-y-4">
      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleAllow}>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Allow
        </button>
      </form>

      <form onSubmit={handleDeny}>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Deny
        </button>
      </form>
    </div>
  );
}
