import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkflowStatus = "draft" | "published" | "archived";

export type WorkflowInputField = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
};

export type WorkflowDefinition = {
  version: number;
  instructions: string;
  input: {
    fields: WorkflowInputField[];
  };
};

export type LegacyWorkflowDefinition = {
  instructions: string;
};

export type WorkflowRow = {
  id: string;
  creator_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  draft_definition: WorkflowDefinition;
  published_definition: WorkflowDefinition | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type WorkflowInput = {
  name: string;
  description: string | null;
  instructions: string;
  inputFields?: WorkflowInputField[];
};

export type WorkflowErrorReason = "unauthorized" | "not_found" | "invalid" | "error";

export type WorkflowResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: WorkflowErrorReason; message?: string };

const WORKFLOW_COLUMNS =
  "id, creator_id, slug, name, description, status, draft_definition, published_definition, created_at, updated_at, published_at";

const PUBLIC_COLUMNS = "id, creator_id, slug, name, description, published_at, updated_at";

type PostgrestError = { code?: string; message?: string };

function asError(error: PostgrestError): { ok: false; reason: WorkflowErrorReason; message?: string } {
  if (error.code === "PGRST116") {
    return { ok: false, reason: "not_found" };
  }
  if (error.code === "42501" || String(error.message).toLowerCase().includes("row-level security")) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: false, reason: "error", message: error.message ?? "Database error." };
}

export function workflowNameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic collision resolution: first free suffix starting at 2.
 */
export function nextWorkflowSlug(base: string, existing: string[]): string {
  if (!base) return "";
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function definitionFromInstructions(
  instructions: string,
  inputFields?: WorkflowInputField[],
): WorkflowDefinition {
  const fields = (inputFields ?? []).filter((f) => f.name.trim() !== "");
  return {
    version: 1,
    instructions: instructions.trim(),
    input: { fields },
  };
}

const VALID_FIELD_TYPES = new Set<WorkflowInputField["type"]>(["string", "number", "boolean"]);

export function validateInputFields(
  fields: unknown,
): { ok: true; fields: WorkflowInputField[] } | { ok: false; message: string } {
  if (!Array.isArray(fields)) {
    return { ok: true, fields: [] };
  }

  const names = new Set<string>();
  const validated: WorkflowInputField[] = [];

  for (const item of fields) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "Each input field must be an object." };
    }
    const field = item as Record<string, unknown>;
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) {
      return { ok: false, message: "Every input field needs a name." };
    }
    if (names.has(name)) {
      return { ok: false, message: `Duplicate input field name: ${name}.` };
    }
    names.add(name);

    const type = field.type;
    if (!VALID_FIELD_TYPES.has(type as WorkflowInputField["type"])) {
      return { ok: false, message: `Invalid type for field "${name}". Use string, number, or boolean.` };
    }

    const description = typeof field.description === "string" ? field.description.trim() || undefined : undefined;
    validated.push({
      name,
      type: type as WorkflowInputField["type"],
      required: Boolean(field.required),
      description,
    });
  }

  return { ok: true, fields: validated };
}

export function isNewWorkflowDefinition(
  def: WorkflowDefinition | LegacyWorkflowDefinition | null | undefined
): def is WorkflowDefinition {
  return (
    !!def &&
    typeof def === "object" &&
    "version" in def &&
    "input" in def &&
    "instructions" in def
  );
}

export function instructionsFromDefinition(definition: unknown): string {
  if (!definition || typeof definition !== "object") return "";
  const def = definition as Record<string, unknown>;
  const value = def.instructions;
  return typeof value === "string" ? value : "";
}

export function inputFieldsFromDefinition(definition: unknown): WorkflowInputField[] {
  if (!definition || typeof definition !== "object") return [];
  const def = definition as Record<string, unknown>;
  if (!isNewWorkflowDefinition(def as WorkflowDefinition | LegacyWorkflowDefinition | null | undefined)) return [];
  const input = def.input as { fields?: WorkflowInputField[] } | undefined;
  return input?.fields ?? [];
}

export function workflowStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function workflowDateLabel(updatedAt: string | null): string {
  if (!updatedAt) return "";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type PublicWorkflow = {
  id: string;
  creator_id: string;
  slug: string;
  name: string;
  description: string | null;
  published_at: string | null;
  updated_at: string | null;
};

/**
 * Find a unique slug for the creator, scoped by creator_id so collisions only
 * consider the authenticated creator's own workflows. RLS additionally limits
 * the lookup to the creator's rows.
 */
export async function findUniqueWorkflowSlug(
  client: SupabaseClient,
  creatorId: string,
  name: string,
): Promise<
  { ok: true; slug: string } | { ok: false; reason: WorkflowErrorReason; message?: string }
> {
  const base = workflowNameToSlug(name);
  if (!base) {
    return { ok: false, reason: "invalid", message: "Name needs at least one letter or number." };
  }
  const { data, error } = await client
    .from("workflows")
    .select("slug")
    .eq("creator_id", creatorId)
    .like("slug", `${base}%`)
    .limit(1000);
  if (error) return asError(error);
  const existing = (data ?? [])
    .map((row) => (row as { slug: string }).slug)
    .filter((slug) => slug === base || slug.startsWith(`${base}-`));
  return { ok: true, slug: nextWorkflowSlug(base, existing) };
}

export async function createWorkflow(
  client: SupabaseClient,
  input: { creator_id: string } & WorkflowInput,
): Promise<WorkflowResult<WorkflowRow>> {
  const name = input.name.trim();
  const instructions = input.instructions.trim();
  if (!name || !instructions) {
    return { ok: false, reason: "invalid", message: "Name and instructions are required." };
  }
  const description = input.description?.trim() || null;
  const fieldValidation = validateInputFields(input.inputFields);
  if (!fieldValidation.ok) {
    return { ok: false, reason: "invalid", message: fieldValidation.message };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slugResult = await findUniqueWorkflowSlug(client, input.creator_id, name);
    if (!slugResult.ok) return slugResult;
    const { data, error } = await client
      .from("workflows")
      .insert({
        creator_id: input.creator_id,
        slug: slugResult.slug,
        name,
        description,
        status: "draft",
        draft_definition: definitionFromInstructions(instructions, fieldValidation.fields),
        published_definition: null,
        published_at: null,
      })
      .select(WORKFLOW_COLUMNS)
      .single();
    if (!error) return { ok: true, data: data as WorkflowRow };
    if (error.code === "23505") continue;
    return asError(error);
  }
  return {
    ok: false,
    reason: "error",
    message: "Could not find a unique workflow slug. Try renaming the workflow.",
  };
}

export async function getWorkflowForCreator(
  client: SupabaseClient,
  id: string,
  creatorId: string,
): Promise<WorkflowResult<WorkflowRow>> {
  const { data, error } = await client
    .from("workflows")
    .select(WORKFLOW_COLUMNS)
    .eq("id", id)
    .eq("creator_id", creatorId)
    .maybeSingle();
  if (error) return asError(error);
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: data as WorkflowRow };
}

export async function getWorkflowsForCreator(
  client: SupabaseClient,
  creatorId: string,
): Promise<WorkflowRow[]> {
  const { data, error } = await client
    .from("workflows")
    .select(WORKFLOW_COLUMNS)
    .eq("creator_id", creatorId)
    .order("updated_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as WorkflowRow[];
}

/**
 * Updates only the draft surface. published_definition, published_at and
 * status are intentionally left untouched so a published workflow keeps
 * serving the old published version until the creator publishes again.
 */
export async function updateWorkflowDraft(
  client: SupabaseClient,
  id: string,
  creatorId: string,
  input: WorkflowInput,
): Promise<WorkflowResult<WorkflowRow>> {
  const name = input.name.trim();
  const instructions = input.instructions.trim();
  if (!name || !instructions) {
    return { ok: false, reason: "invalid", message: "Name and instructions are required." };
  }
  const description = input.description?.trim() || null;
  const fieldValidation = validateInputFields(input.inputFields);
  if (!fieldValidation.ok) {
    return { ok: false, reason: "invalid", message: fieldValidation.message };
  }
  const { data, error } = await client
    .from("workflows")
    .update({
      name,
      description,
      draft_definition: definitionFromInstructions(instructions, fieldValidation.fields),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("creator_id", creatorId)
    .select(WORKFLOW_COLUMNS)
    .single();
  if (error) return asError(error);
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: data as WorkflowRow };
}

/**
 * One atomic update: snapshots the current draft_definition into
 * published_definition, marks the workflow published and stamps published_at.
 */
export async function publishWorkflow(
  client: SupabaseClient,
  id: string,
  creatorId: string,
): Promise<WorkflowResult<WorkflowRow>> {
  const current = await getWorkflowForCreator(client, id, creatorId);
  if (!current.ok) return current;
  const workflow = current.data;
  const instructions = instructionsFromDefinition(workflow.draft_definition);
  if (!workflow.name.trim() || !instructions.trim()) {
    return { ok: false, reason: "invalid", message: "Add a name and instructions before publishing." };
  }
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("workflows")
    .update({
      status: "published",
      published_definition: workflow.draft_definition,
      published_at: now,
      updated_at: now,
    })
    .eq("id", id)
    .eq("creator_id", creatorId)
    .select(WORKFLOW_COLUMNS)
    .single();
  if (error) return asError(error);
  if (!data) return { ok: false, reason: "not_found" };
  return { ok: true, data: data as WorkflowRow };
}

/**
 * Public surface only. Resolves exclusively through the public_workflows view,
 * which never exposes draft_definition and only contains published rows.
 */
export async function getPublishedWorkflow(
  client: SupabaseClient,
  creatorId: string,
  workflowSlug: string,
): Promise<PublicWorkflow | null> {
  const { data, error } = await client
    .from("public_workflows")
    .select(PUBLIC_COLUMNS)
    .eq("creator_id", creatorId)
    .eq("slug", workflowSlug)
    .maybeSingle();
  if (error || !data) return null;
  return data as PublicWorkflow;
}

export async function getPublishedWorkflowsForCreator(
  client: SupabaseClient,
  creatorId: string,
): Promise<PublicWorkflow[]> {
  const { data, error } = await client
    .from("public_workflows")
    .select(PUBLIC_COLUMNS)
    .eq("creator_id", creatorId)
    .order("published_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as PublicWorkflow[];
}

export type PublishedWorkflowWithDefinition = PublicWorkflow & {
  published_definition: WorkflowDefinition | null;
};