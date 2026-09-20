"use client";

import { useState } from "react";
import type { Dictionary } from "@/i18n/dictionary";

type Status = "idle" | "submitting" | "success" | "error";

const SUBMIT_URL = "https://api.web3forms.com/submit";
const SUBJECT = "New Permudah Early Access Signup";

export function EarlyAccessForm({ ui }: { ui: Dictionary["hero"] }) {
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");

  async function submit(): Promise<void> {
    const response = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_key: process.env.NEXT_PUBLIC_WEB3FORMS_ACCESS_KEY ?? "",
        email,
        subject: SUBJECT,
        botcheck: "",
      }),
    });

    if (!response.ok) {
      throw new Error("Web3Forms request failed");
    }

    const data = (await response.json()) as { success?: boolean };
    if (data.success !== true) {
      throw new Error("Web3Forms rejected submission");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setStatus("submitting");
    try {
      await submit();
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p role="status" className="text-sm font-medium text-blue-600">
        {ui.successMessage}
      </p>
    );
  }

  const submitting = status === "submitting";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
        noValidate
      >
        <label htmlFor="email" className="sr-only">
          {ui.emailLabel}
        </label>
        <input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          disabled={submitting}
          placeholder={ui.emailPlaceholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-12 flex-1 rounded-full border border-zinc-200 bg-white px-5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/10 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={submitting}
          className="h-12 shrink-0 rounded-full bg-blue-600 px-6 text-base font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? ui.submittingLabel : ui.cta}
        </button>
        <input
          type="text"
          name="botcheck"
          value=""
          tabIndex={-1}
          aria-hidden="true"
          autoComplete="off"
          className="hidden"
        />
      </form>
      {status === "error" && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {ui.errorMessage}
        </p>
      )}
    </>
  );
}