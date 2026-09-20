"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createCreatorWithClient } from "@/lib/create-creator";
import { createClient } from "@/lib/supabase/client";
import { creatorStorefrontUrl, validateCreatorSlug } from "@/lib/slug";

type Availability = "idle" | "checking" | "available" | "taken";

type SlugCheck =
  | "empty"
  | "invalid"
  | "reserved"
  | "checking"
  | "available"
  | "taken";

const SLUG_RULES =
  "Lowercase letters, numbers, and hyphens. Must start and end with a letter or number.";

export function CreatorOnboardingForm() {
  const [displayName, setDisplayName] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [bio, setBio] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [checkedSlug, setCheckedSlug] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = slugInput.trim().toLowerCase();
  const validation = validateCreatorSlug(normalized);
  const normalizedRef = useRef(normalized);

  const slugCheck: SlugCheck = !normalized
    ? "empty"
    : !validation.ok
      ? validation.reason === "required"
        ? "invalid"
        : validation.reason
      : availability === "idle" ||
          availability === "checking" ||
          checkedSlug !== normalized
        ? "checking"
        : availability;

  useEffect(() => {
    normalizedRef.current = normalized;
    if (!normalized || !validateCreatorSlug(normalized).ok) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/creator-slug?slug=${encodeURIComponent(normalized)}`,
        );
        if (!response.ok) throw new Error("request failed");
        const result = (await response.json()) as {
          available: boolean;
          reason?: "invalid" | "reserved" | "taken";
        };
        if (normalizedRef.current !== normalized) return;
        setCheckedSlug(normalized);
        setAvailability(result.available ? "available" : "taken");
      } catch {
        if (normalizedRef.current !== normalized) return;
        setCheckedSlug(normalized);
        setAvailability("available");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [normalized]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    if (!validation.ok) {
      const message =
        validation.reason === "required"
          ? "Slug is required."
          : validation.reason === "reserved"
            ? "That name is reserved."
            : SLUG_RULES;
      setError(message);
      return;
    }

    if (slugCheck === "taken" || slugCheck === "reserved") {
      setError("That slug is already taken.");
      return;
    }

    setSubmitting(true);
    const client = createClient();
    const result = await createCreatorWithClient(client, {
      display_name: displayName.trim(),
      slug: validation.slug,
      bio: bio.trim() || null,
    });

    if (result.ok) {
      window.location.assign(
        creatorStorefrontUrl(result.creator.slug, window.location.origin),
      );
      return;
    }

    setSubmitting(false);
    if (result.reason === "taken") {
      setError("That slug is already taken.");
    } else if (result.reason === "unauthorized") {
      setError("Your session expired. Please sign in again.");
    } else {
      setError("Could not create your storefront. Please try again.");
    }
  }

  function slugHelperText(): { text: string; color: string } | null {
    switch (slugCheck) {
      case "empty":
        return null;
      case "checking":
        return { text: "Checking availability…", color: "text-zinc-500" };
      case "available":
        return {
          text: `Available — ${normalized}.permudah.com`,
          color: "text-emerald-600",
        };
      case "taken":
        return { text: "This slug is already taken.", color: "text-red-600" };
      case "reserved":
        return { text: "This name is reserved.", color: "text-red-600" };
      default:
        return { text: SLUG_RULES, color: "text-red-600" };
    }
  }

  const helper = slugHelperText();

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <label
          htmlFor="display_name"
          className="block text-sm font-medium text-slate-800"
        >
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Master Digital"
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      <div>
        <label
          htmlFor="slug"
          className="block text-sm font-medium text-slate-800"
        >
          Storefront URL
        </label>
        <div className="relative mt-1.5">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-zinc-400">
            {normalized || "slug"}.
          </span>
          <input
            id="slug"
            name="slug"
            type="text"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={slugInput}
            onChange={(event) => setSlugInput(event.target.value)}
            placeholder="masterdigital"
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-24 pl-20 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-zinc-400">
            .permudah.com
          </span>
        </div>
        {helper ? (
          <p className={`mt-1.5 text-xs ${helper.color}`}>{helper.text}</p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="bio"
          className="block text-sm font-medium text-slate-800"
        >
          Bio <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          placeholder="Tell visitors what your storefront is about."
          className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Creating your storefront…" : "Create my storefront"}
      </button>
    </form>
  );
}