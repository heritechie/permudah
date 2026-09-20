"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { workflowPublicUrl } from "@/lib/slug";
import type { WorkflowInputField, WorkflowStatus } from "@/lib/workflows";

type WorkflowFormProps = {
  mode: "create" | "edit";
  creatorSlug: string;
  origin?: string;
  workflowId?: string;
  workflowSlug?: string;
  status?: WorkflowStatus;
  initial?: {
    name: string;
    description: string;
    instructions: string;
    inputFields?: WorkflowInputField[];
  };
};

type LocalInputField = WorkflowInputField & { key: string };

type SavingState = "none" | "draft" | "publish";

const REQUIRED_MESSAGE =
  "Please enter a name and instructions before saving.";

function makeFieldKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toLocalFields(fields?: WorkflowInputField[]): LocalInputField[] {
  return (fields ?? []).map((field) => ({ ...field, key: makeFieldKey() }));
}

function fromLocalFields(fields: LocalInputField[]): WorkflowInputField[] {
  return fields
    .filter((field) => field.name.trim() !== "")
    .map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      description: field.description,
    }));
}

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
  const [inputFields, setInputFields] = useState<LocalInputField[]>(
    () => toLocalFields(initial?.inputFields),
  );
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

  function validateFields(): { ok: true } | { ok: false; message: string } {
    const seen = new Set<string>();
    for (const field of inputFields) {
      const trimmed = field.name.trim();
      if (!trimmed) {
        return { ok: false, message: "Every input field needs a name." };
      }
      if (seen.has(trimmed)) {
        return { ok: false, message: `Duplicate input field name: ${trimmed}.` };
      }
      seen.add(trimmed);
      if (!["string", "number", "boolean"].includes(field.type)) {
        return { ok: false, message: `Invalid type for field "${trimmed}".` };
      }
    }
    return { ok: true };
  }

  function buildPayload() {
    return {
      name: name.trim(),
      description: description.trim() || null,
      instructions: instructions.trim(),
      inputFields: fromLocalFields(inputFields),
    };
  }

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
    body?: ReturnType<typeof buildPayload>,
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
    const payload = buildPayload();
    if (!payload.name || !payload.instructions) {
      setError(REQUIRED_MESSAGE);
      return;
    }
    const fieldCheck = validateFields();
    if (!fieldCheck.ok) {
      setError(fieldCheck.message);
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
    const payload = buildPayload();
    if (!payload.name || !payload.instructions) {
      setError(REQUIRED_MESSAGE);
      return;
    }
    const fieldCheck = validateFields();
    if (!fieldCheck.ok) {
      setError(fieldCheck.message);
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

  function addField(): void {
    setInputFields((prev) => [
      ...prev,
      {
        key: makeFieldKey(),
        name: "",
        type: "string",
        required: true,
        description: "",
      },
    ]);
  }

  function updateField(
    key: string,
    patch: Partial<WorkflowInputField>,
  ): void {
    setInputFields((prev) =>
      prev.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    );
  }

  function removeField(key: string): void {
    setInputFields((prev) => prev.filter((field) => field.key !== key));
  }

  const inputClasses =
    "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
  const labelClasses = "mt-5 block text-sm font-medium text-slate-700";
  const smallInputClasses =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
  const selectClasses =
    "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";

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

      <div className={labelClasses}>Inputs</div>
      <p className="text-sm text-zinc-500">
        Define the input fields ChatGPT will ask the customer for.
      </p>

      <div className="mt-3 space-y-3">
        {inputFields.map((field) => (
          <div
            key={field.key}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[12rem] flex-1">
                <label
                  htmlFor={`field-name-${field.key}`}
                  className="block text-xs font-medium text-slate-600"
                >
                  Name
                </label>
                <input
                  id={`field-name-${field.key}`}
                  type="text"
                  value={field.name}
                  onChange={(event) =>
                    updateField(field.key, { name: event.target.value })
                  }
                  placeholder="topic"
                  className={smallInputClasses}
                />
              </div>

              <div>
                <label
                  htmlFor={`field-type-${field.key}`}
                  className="block text-xs font-medium text-slate-600"
                >
                  Type
                </label>
                <select
                  id={`field-type-${field.key}`}
                  value={field.type}
                  onChange={(event) =>
                    updateField(field.key, {
                      type: event.target.value as WorkflowInputField["type"],
                    })
                  }
                  className={selectClasses}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) =>
                    updateField(field.key, { required: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Required
              </label>

              <button
                type="button"
                onClick={() => removeField(field.key)}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>

            <div className="mt-3">
              <label
                htmlFor={`field-desc-${field.key}`}
                className="block text-xs font-medium text-slate-600"
              >
                Description{" "}
                <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                id={`field-desc-${field.key}`}
                type="text"
                value={field.description ?? ""}
                onChange={(event) =>
                  updateField(field.key, {
                    description: event.target.value || undefined,
                  })
                }
                placeholder="What the customer should enter"
                className={smallInputClasses}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addField}
        className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
      >
        + Add input field
      </button>

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
