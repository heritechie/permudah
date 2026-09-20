"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { workflowPublicUrl } from "@/lib/slug";
import type { WorkflowStatus } from "@/lib/workflows";

type WorkflowFormProps = {
  mode: "create" | "edit";
  creatorSlug: string;
  origin?: string;
  workflowId?: string;
  workflowSlug?: string;
  status?: WorkflowStatus;
  initial?: { name: string; description: string; instructions: string };
};

type SavingState = "none" | "draft" | "publish";

const REQUIRED_MESSAGE =
  "Please enter a name and instructions before saving.";

export function WorkflowForm({
  mode,
  creatorSlug,
  origin,
  workflowId,
  workflowSlug,
  status,
  initial,
}: WorkflowFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [saving, setSaving] = useState<SavingState>("none");
  const [error, setError] = useState<string | null>(null);

  const published = status === "published" && workflowSlug !== undefined;
  const publicUrl = useMemo(
    () =>
      published
        ? workflowPublicUrl(creatorSlug, workflowSlug as string, origin)
        : null,
    [published, creatorSlug, workflowSlug, origin],
  );

  function applyError(statusCode: number, json: { message?: string }): void {
    setSaving("none");
    if (statusCode === 401) {
      setError("Your session expired. Sign in again.");
      router.push("/login");
      return;
    }
    if (statusCode === 404) {
      setError("This workflow could not be found.");
      return;
    }
    setError(json.message ?? "Something went wrong. Please try again.");
  }

  async function post(
    url: string,
    body?: { name: string; description: string | null; instructions: string },
  ): Promise<{
    ok: boolean;
    status: number;
    json: { message?: string; data?: { id?: string } };
  }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: { message?: string; data?: { id?: string } } = await response
      .json()
      .catch(() => ({}));
    return { ok: response.ok, status: response.status, json };
  }

  async function saveDraft(event: FormEvent): Promise<void> {
    event.preventDefault();
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      instructions: instructions.trim(),
    };
    if (!payload.name || !payload.instructions) {
      setError(REQUIRED_MESSAGE);
      return;
    }

    setError(null);
    setSaving("draft");
    try {
      if (mode === "create") {
        const result = await post("/api/workflows", payload);
        if (!result.ok) {
          applyError(result.status, result.json);
          return;
        }
        const createdId = result.json.data?.id;
        if (!createdId) {
          setError("The workflow was created without an id. Please try again.");
          setSaving("none");
          return;
        }
        router.push(`/dashboard/workflows/${createdId}`);
        return;
      }
      if (!workflowId) return;
      const result = await post(`/api/workflows/${workflowId}/draft`, payload);
      if (!result.ok) {
        applyError(result.status, result.json);
        return;
      }
      setSaving("none");
    } catch {
      setError("Network error. Please try again.");
      setSaving("none");
    }
  }

  async function publish(): Promise<void> {
    if (mode !== "edit" || !workflowId) return;
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      instructions: instructions.trim(),
    };
    if (!payload.name || !payload.instructions) {
      setError(REQUIRED_MESSAGE);
      return;
    }

    setError(null);
    setSaving("publish");
    try {
      const draftResult = await post(`/api/workflows/${workflowId}/draft`, payload);
      if (!draftResult.ok) {
        applyError(draftResult.status, draftResult.json);
        return;
      }
      const result = await post(`/api/workflows/${workflowId}/publish`);
      if (!result.ok) {
        applyError(result.status, result.json);
        return;
      }
      setSaving("none");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSaving("none");
    }
  }

  const inputClasses =
    "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
  const labelClasses = "mt-5 block text-sm font-medium text-slate-700";

  return (
    <form onSubmit={saveDraft}>
      <label className="block text-sm font-medium text-slate-700" htmlFor="name">
        Name
      </label>
      <input
        id="name"
        name="name"
        type="text"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Instagram Carousel"
        className={inputClasses}
      />

      <label className={labelClasses} htmlFor="description">
        Description{" "}
        <span className="font-normal text-zinc-400">(optional)</span>
      </label>
      <textarea
        id="description"
        name="description"
        rows={3}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="What does this workflow do?"
        className={inputClasses}
      />

      <label className={labelClasses} htmlFor="instructions">
        Instructions
      </label>
      <textarea
        id="instructions"
        name="instructions"
        rows={12}
        required
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder="Describe exactly what the workflow should do for the customer."
        className={`${inputClasses} font-mono`}
      />

      {published && publicUrl ? (
        <p className="mt-5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Published. Public URL:{" "}
          <a
            href={publicUrl}
            className="font-medium text-green-900 underline underline-offset-2"
          >
            {publicUrl}
          </a>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving !== "none"}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving === "draft" ? "Saving…" : "Save Draft"}
        </button>

        {mode === "edit" ? (
          <button
            type="button"
            disabled={saving !== "none"}
            onClick={publish}
            className="rounded-lg border border-blue-600 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving === "publish" ? "Publishing…" : "Publish"}
          </button>
        ) : null}

        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
        >
          Back to dashboard
        </Link>
      </div>
    </form>
  );
}