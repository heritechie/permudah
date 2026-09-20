import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import {
  createWorkflow,
  findUniqueWorkflowSlug,
  getPublishedWorkflow,
  getPublishedWorkflowsForCreator,
  getWorkflowForCreator,
  getWorkflowsForCreator,
  nextWorkflowSlug,
  publishWorkflow,
  updateWorkflowDraft,
  workflowNameToSlug,
  type WorkflowRow,
} from "./workflows";

type Row = Record<string, unknown>;

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

type Call = {
  table: string;
  op: string;
  payload?: unknown;
  filters?: Array<[string, unknown]>;
};

function fakeClient({ workflows = [], publicWorkflows = [] }: {
  workflows?: Row[];
  publicWorkflows?: Row[];
}): { client: SupabaseClient; calls: Call[]; store: { workflows: Row[]; publicWorkflows: Row[] } } {
  const store = {
    workflows: workflows.map((row) => ({ ...row })),
    publicWorkflows: publicWorkflows.map((row) => ({ ...row })),
  };
  const calls: Call[] = [];

  function chain(table: "workflows" | "publicWorkflows", onInsert?: (payload: Row) => Row) {
    const state = {
      filters: [] as Array<[string, unknown]>,
      pendingUpdate: null as Row | null,
    };
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        state.filters.push([column, value]);
        return q;
      },
      like: () => q,
      limit: () => q,
      order: () => q,
      maybeSingle: async () => {
        calls.push({ table, op: "select", filters: [...state.filters] });
        const row = store[table].find((r) => matches(r, state.filters)) ?? null;
        return { data: row, error: null };
      },
      single: async () => {
        if (state.pendingUpdate) {
          calls.push({ table, op: "update", payload: state.pendingUpdate, filters: [...state.filters] });
          const target = store[table].find((r) => matches(r, state.filters));
          if (!target) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
          Object.assign(target, state.pendingUpdate);
          state.pendingUpdate = null;
          return { data: target, error: null };
        }
        calls.push({ table, op: "select", filters: [...state.filters] });
        const row = store[table].find((r) => matches(r, state.filters)) ?? null;
        if (!row) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
        return { data: row, error: null };
      },
      update: (payload: Row) => {
        state.pendingUpdate = payload;
        return q;
      },
      insert: (payload: Row) => {
        calls.push({ table, op: "insert", payload, filters: [...state.filters] });
        return {
          select: () => ({
            single: async () => {
              if (!onInsert) return { data: null, error: { code: "error", message: "no insert handler" } };
              return onInsert(payload);
            },
          }),
        };
      },
      then: (
        resolve: (value: { data: Row[]; error: null }) => unknown,
      ) => {
        calls.push({ table, op: "select", filters: [...state.filters] });
        const rows = store[table].filter((r) => matches(r, state.filters));
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return q;
  }

  const workflowsTable = chain("workflows", (payload) => {
    const exists = store.workflows.some(
      (row) =>
        row.creator_id === payload.creator_id && row.slug === payload.slug,
    );
    if (exists) {
      return { data: null, error: { code: "23505", message: "duplicate key value" } };
    }
    const row: Row = {
      id: payload.id ?? "wf-1",
      created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-09-20T00:00:00.000Z",
      published_at: null,
      ...payload,
    };
    store.workflows.push(row);
    return { data: row, error: null };
  });
  const publicTable = chain("publicWorkflows");

  const client = {
    from: (table: string) => {
      if (table === "public_workflows") return publicTable;
      return workflowsTable;
    },
  } as unknown as SupabaseClient;

  return { client, calls, store };
}

function draftRow(overrides: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-1",
    creator_id: "creator-a",
    slug: "instagram-carousel",
    name: "Instagram Carousel",
    description: null,
    status: "draft",
    draft_definition: { version: 1, instructions: "Write a caption.", input: { fields: [] } },
    published_definition: null,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    published_at: null,
    ...overrides,
  };
}

const CREATOR_A = "creator-a";
const CREATOR_B = "creator-b";

describe("workflowNameToSlug", () => {
  test("converts a name to a slug", () => {
    expect(workflowNameToSlug("Instagram Carousel")).toBe("instagram-carousel");
    expect(workflowNameToSlug("  My!@ Great Work*f$low  ")).toBe("my-great-work-f-low");
    expect(workflowNameToSlug("123")).toBe("123");
  });
});

describe("nextWorkflowSlug", () => {
  test("returns the base when free", () => {
    expect(nextWorkflowSlug("instagram-carousel", [])).toBe("instagram-carousel");
  });

  test("appends a deterministic suffix on collision", () => {
    expect(
      nextWorkflowSlug("instagram-carousel", ["instagram-carousel", "instagram-carousel-2"]),
    ).toBe("instagram-carousel-3");
  });

  test("fills the first free gap", () => {
    expect(
      nextWorkflowSlug("instagram-carousel", ["instagram-carousel", "instagram-carousel-2", "instagram-carousel-4"]),
    ).toBe("instagram-carousel-3");
  });
});

describe("createWorkflow", () => {
  test("creates a draft with a slug generated from the name", async () => {
    const { client, calls, store } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Instagram Carousel",
      description: "Caption generator",
      instructions: "Write an on-brand caption.",
    });

    expect(result.ok).toBe(true);
    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload).toMatchObject({
      creator_id: CREATOR_A,
      slug: "instagram-carousel",
      name: "Instagram Carousel",
      description: "Caption generator",
      status: "draft",
      draft_definition: { instructions: "Write an on-brand caption." },
      published_definition: null,
      published_at: null,
    });
    expect(store.workflows).toHaveLength(1);
    if (!result.ok) return;
    expect(result.data.status).toBe("draft");
  });

  test("adds a deterministic suffix when the base slug exists", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ id: "wf-1", slug: "instagram-carousel" }));
    store.workflows.push(draftRow({ id: "wf-2", slug: "instagram-carousel-2" }));

    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Instagram Carousel",
      description: null,
      instructions: "x",
    });
    expect(result.ok).toBe(true);
    expect(
      store.workflows.find((row) => row.id === "wf-3") ?? result,
    ).toBeDefined();
    const created = store.workflows.find((row) => row.slug === "instagram-carousel-3");
    expect(created?.slug).toBe("instagram-carousel-3");
  });

  test("does not overwrite another creator's slug", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ id: "wf-other", creator_id: CREATOR_B, slug: "instagram-carousel" }));

    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Instagram Carousel",
      description: null,
      instructions: "x",
    });
    expect(result.ok).toBe(true);
    expect(store.workflows.find((row) => row.creator_id === CREATOR_A)?.slug).toBe(
      "instagram-carousel",
    );
  });

  test("rejects empty input without inserting", async () => {
    const { client, calls, store } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "  ",
      description: null,
      instructions: "",
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "insert")).toHaveLength(0);
    expect(store.workflows).toHaveLength(0);
  });
});

describe("getWorkflowForCreator / getWorkflowsForCreator", () => {
  test("returns the creator's own workflow", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow());

    const result = await getWorkflowForCreator(client, "wf-1", CREATOR_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe("wf-1");
  });

  test("cannot access another creator's workflow", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ creator_id: CREATOR_B }));

    const result = await getWorkflowForCreator(client, "wf-1", CREATOR_A);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  test("lists only the creator's workflows, newest first", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ id: "wf-a", updated_at: "2026-09-19T00:00:00.000Z" }));
    store.workflows.push(draftRow({ id: "wf-b", creator_id: CREATOR_B }));
    store.workflows.push(draftRow({ id: "wf-c", updated_at: "2026-09-21T00:00:00.000Z" }));

    const workflows = await getWorkflowsForCreator(client, CREATOR_A);
    expect(workflows.map((wf) => wf.id)).toEqual(["wf-a", "wf-c"]);
  });
});

describe("updateWorkflowDraft", () => {
  test("persists the draft and leaves the published version untouched", async () => {
    const published = draftRow({
      status: "published",
      draft_definition: { version: 1, instructions: "new draft version", input: { fields: [] } },
      published_definition: { version: 1, instructions: "old published version", input: { fields: [] } },
      published_at: "2026-09-10T00:00:00.000Z",
    });
    const { client, calls, store } = fakeClient({});
    store.workflows.push(published);

    const result = await updateWorkflowDraft(client, "wf-1", CREATOR_A, {
      name: "Renamed",
      description: "Updated description",
      instructions: "newer draft version",
    });

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({
      name: "Renamed",
      description: "Updated description",
      draft_definition: { instructions: "newer draft version" },
    });
    expect(update?.payload).toHaveProperty("updated_at");
    expect(update?.payload).not.toHaveProperty("status");
    expect(update?.payload).not.toHaveProperty("published_definition");
    expect(update?.payload).not.toHaveProperty("published_at");

    const row = store.workflows[0];
    expect(row.published_definition).toEqual({ version: 1, instructions: "old published version", input: { fields: [] } });
    expect(row.status).toBe("published");
    expect(row.draft_definition).toEqual({
      version: 1,
      instructions: "newer draft version",
      input: { fields: [] },
    });
  });

  test("rejects empty input", async () => {
    const { client, calls, store } = fakeClient({});
    store.workflows.push(draftRow());
    const result = await updateWorkflowDraft(client, "wf-1", CREATOR_A, {
      name: "  ",
      description: null,
      instructions: "",
    });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  test("cannot update another creator's workflow", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ creator_id: CREATOR_B }));
    const result = await updateWorkflowDraft(client, "wf-1", CREATOR_A, {
      name: "x",
      description: null,
      instructions: "y",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("publishWorkflow", () => {
  test("copies draft_definition to published_definition in one atomic update", async () => {
    const { client, calls, store } = fakeClient({});
    store.workflows.push(draftRow({ draft_definition: { version: 1, instructions: "the final version", input: { fields: [] } } }));

    const result = await publishWorkflow(client, "wf-1", CREATOR_A);

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({
      status: "published",
      published_definition: { version: 1, instructions: "the final version", input: { fields: [] } },
    });
    expect(update?.payload).toHaveProperty("published_at");
    expect(update?.payload).toHaveProperty("updated_at");
    // single atomic update
    expect(calls.filter((call) => call.op === "update")).toHaveLength(1);

    const row = store.workflows[0];
    expect(row.status).toBe("published");
    expect(row.published_definition).toEqual({ version: 1, instructions: "the final version", input: { fields: [] } });
    expect(row.published_at).toBeTruthy();
  });

  test("rejects an empty draft", async () => {
    const { client, calls, store } = fakeClient({});
    store.workflows.push(draftRow({ draft_definition: { version: 1, instructions: "", input: { fields: [] } } }));
    const result = await publishWorkflow(client, "wf-1", CREATOR_A);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  test("cannot publish another creator's workflow", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(draftRow({ creator_id: CREATOR_B }));
    const result = await publishWorkflow(client, "wf-1", CREATOR_A);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("input fields", () => {
  test("creates a workflow with multiple input fields", async () => {
    const { client, calls } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Instagram Carousel",
      description: null,
      instructions: "Generate carousel.",
      inputFields: [
        { name: "topic", type: "string", required: true, description: "Topic" },
        { name: "audience", type: "string", required: true },
        { name: "includeCta", type: "boolean", required: false, description: "Include CTA" },
      ],
    });

    expect(result.ok).toBe(true);
    const insert = calls.find((call) => call.op === "insert");
    expect(insert?.payload).toMatchObject({
      draft_definition: {
        version: 1,
        instructions: "Generate carousel.",
        input: {
          fields: [
            { name: "topic", type: "string", required: true, description: "Topic" },
            { name: "audience", type: "string", required: true },
            { name: "includeCta", type: "boolean", required: false, description: "Include CTA" },
          ],
        },
      },
    });
  });

  test("updates draft input fields", async () => {
    const { client, store, calls } = fakeClient({});
    store.workflows.push(
      draftRow({
        draft_definition: {
          version: 1,
          instructions: "Generate carousel.",
          input: { fields: [{ name: "topic", type: "string", required: true }] },
        },
      }),
    );

    const result = await updateWorkflowDraft(client, "wf-1", CREATOR_A, {
      name: "Instagram Carousel",
      description: null,
      instructions: "Generate carousel.",
      inputFields: [
        { name: "topic", type: "string", required: true, description: "Main topic" },
        { name: "tone", type: "string", required: false },
      ],
    });

    expect(result.ok).toBe(true);
    const update = calls.find((call) => call.op === "update");
    expect(update?.payload).toMatchObject({
      draft_definition: {
        version: 1,
        instructions: "Generate carousel.",
        input: {
          fields: [
            { name: "topic", type: "string", required: true, description: "Main topic" },
            { name: "tone", type: "string", required: false },
          ],
        },
      },
    });
  });

  test("publish preserves input fields from draft_definition", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(
      draftRow({
        draft_definition: {
          version: 1,
          instructions: "Generate carousel.",
          input: { fields: [{ name: "topic", type: "string", required: true }] },
        },
      }),
    );

    const result = await publishWorkflow(client, "wf-1", CREATOR_A);
    expect(result.ok).toBe(true);

    const row = store.workflows[0];
    expect(row.published_definition).toEqual({
      version: 1,
      instructions: "Generate carousel.",
      input: { fields: [{ name: "topic", type: "string", required: true }] },
    });
  });

  test("legacy workflow without input fields remains backward-compatible", async () => {
    const { client, store } = fakeClient({});
    store.workflows.push(
      draftRow({
        draft_definition: { version: 1, instructions: "Legacy workflow.", input: { fields: [] } },
      }),
    );

    const result = await getWorkflowForCreator(client, "wf-1", CREATOR_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.draft_definition.input.fields).toEqual([]);

    const publishResult = await publishWorkflow(client, "wf-1", CREATOR_A);
    expect(publishResult.ok).toBe(true);
  });

  test("rejects duplicate input field names", async () => {
    const { client, calls } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Test",
      description: null,
      instructions: "x",
      inputFields: [
        { name: "topic", type: "string", required: true },
        { name: "topic", type: "number", required: false },
      ],
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  test("rejects input field without a name", async () => {
    const { client, calls } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Test",
      description: null,
      instructions: "x",
      inputFields: [{ name: "", type: "string", required: true }],
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  test("rejects invalid input field type", async () => {
    const { client, calls } = fakeClient({});
    const result = await createWorkflow(client, {
      creator_id: CREATOR_A,
      name: "Test",
      description: null,
      instructions: "x",
      inputFields: [{ name: "topic", type: "date", required: true } as unknown as { name: string; type: "string"; required: boolean }],
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("invalid");
    expect(calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });
});

describe("public workflow queries", () => {
  test("only resolves published workflows", async () => {
    const { client, store } = fakeClient({});
    store.publicWorkflows.push({
      id: "wf-pub",
      creator_id: CREATOR_A,
      slug: "instagram-carousel",
      name: "Instagram Carousel",
      description: null,
      published_at: "2026-09-15T00:00:00.000Z",
    });

    const found = await getPublishedWorkflow(client, CREATOR_A, "instagram-carousel");
    expect(found?.slug).toBe("instagram-carousel");

    // A draft does not exist in the public view.
    const draft = await getPublishedWorkflow(client, CREATOR_A, "instagram-draft");
    expect(draft).toBeNull();
  });

  test("storefront lists only published workflows", async () => {
    const { client, store } = fakeClient({});
    store.publicWorkflows.push({
      id: "wf-pub",
      creator_id: CREATOR_A,
      slug: "instagram-carousel",
      name: "Instagram Carousel",
      description: null,
      published_at: "2026-09-15T00:00:00.000Z",
    });

    const workflows = await getPublishedWorkflowsForCreator(client, CREATOR_A);
    expect(workflows.map((wf) => wf.slug)).toEqual(["instagram-carousel"]);

    const other = await getPublishedWorkflowsForCreator(client, CREATOR_B);
    expect(other).toEqual([]);
  });
});

describe("findUniqueWorkflowSlug", () => {
  test("scopes the lookup to the creator and resolves collisions", async () => {
    const { client, store, calls } = fakeClient({});
    store.workflows.push(draftRow({ slug: "instagram-carousel" }));

    const result = await findUniqueWorkflowSlug(client, CREATOR_A, "Instagram Carousel");
    expect(result).toEqual({ ok: true, slug: "instagram-carousel-2" });

    const selectCall = calls.find((call) => call.op === "select");
    expect(selectCall?.filters).toContainEqual(["creator_id", CREATOR_A]);
  });
});