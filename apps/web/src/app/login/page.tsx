import type { Metadata } from "next";
import Image from "next/image";
import { LoginForm } from "@/components/login-form";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; redirect?: string }>;
};

export const metadata: Metadata = {
  title: "Sign in — Permudah",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, redirect: redirectTo } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Image
            src="/images/permudah-logo.png"
            alt="Permudah"
            width={146}
            height={50}
            className="h-10 w-auto"
          />
        </div>
        <h1 className="mt-8 text-center text-2xl font-semibold tracking-tight text-slate-900">
          Sign in to Permudah
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-500">
          We&apos;ll email you a magic link to get started.
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error === "missing_authorization"
              ? "Missing authorization request."
              : error === "invalid_authorization"
                ? "Invalid or expired authorization request."
                : "Unable to sign in. Please try again."}
          </p>
        ) : null}

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm redirectTo={redirectTo} />
        </div>

        <p className="mt-6 text-center text-sm text-zinc-500">
          <a href="https://permudah.com" className="font-medium text-blue-600 hover:text-blue-700">
            Back to Permudah
          </a>
        </p>
      </div>
    </main>
  );
}