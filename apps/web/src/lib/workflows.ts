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

export function definitionFromInstructions(instructions: string): WorkflowDefinition {
  return {
    version: 1,
    instructions: instructions.trim(),
    input: { fields: [] },
  };
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
        draft_definition: definitionFromInstructions(instructions),
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
  const { data, error } = await client
    .from("workflows")
    .update({
      name,
      description,
      draft_definition: definitionFromInstructions(instructions),
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

/**
 * Fetch a single published workflow with its full definition (including input schema).
 * Used by the MCP server to discover the tool schema dynamically.
 */
export async function getPublishedWorkflowForMcp(
  client: SupabaseClient,
  creatorSlug: string,
  workflowSlug: string,
): Promise<PublishedWorkflowWithDefinition | null> {
  // First resolve creator slug to creator_id
  const { data: creator, error: creatorError } = await client
    .from("creators")
    .select("id")
    .eq("slug", creatorSlug)
    .maybeSingle();
  if (creatorError || !creator) return null;

  const { data, error } = await client
    .from("public_workflows")
    .select("id, creator_id, slug, name, description, published_definition, published_at, updated_at")
    .eq("creator_id", creator.id)
    .eq("slug", workflowSlug)
    .maybeSingle();
  if (error || !data) return null;
  return data as PublishedWorkflowWithDefinition;
}

/**
 * Find the first published Instagram Carousel workflow for MCP tool discovery.
 * This is a POC-specific function that finds a workflow with the expected input fields.
 */
export async function findInstagramCarouselWorkflow(
  client: SupabaseClient,
): Promise<PublishedWorkflowWithDefinition | null> {
  const { data, error } = await client
    .from("public_workflows")
    .select("id, creator_id, slug, name, description, published_definition, published_at, updated_at")
    .like("name", "%Instagram%Carousel%")
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as PublishedWorkflowWithDefinition;
}