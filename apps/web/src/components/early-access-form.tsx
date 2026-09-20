"use client";

import { useState } from "react";

export function EarlyAccessForm() {
  const [subscribed, setSubscribed] = useState(false);
  const [email, setEmail] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email) return;
    setSubscribed(true);
  }

  if (subscribed) {
    return (
      <p className="text-sm font-medium text-blue-600">
        Terima kasih! Kami akan mengabari kamu saat Permudah siap.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
    >
      <label htmlFor="email" className="sr-only">
        Alamat email
      </label>
      <input
        id="email"
        type="email"
        name="email"
        required
        autoComplete="email"
        placeholder="nama@email.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="h-12 flex-1 rounded-full border border-zinc-200 bg-white px-5 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/10"
      />
      <button
        type="submit"
        className="h-12 shrink-0 rounded-full bg-blue-600 px-6 text-base font-medium text-white transition-colors hover:bg-blue-700"
      >
        Dapatkan Early Access
      </button>
    </form>
  );
}