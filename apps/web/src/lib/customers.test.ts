import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { getOrCreateCustomer, getCustomerEntitlement, hasWorkflowEntitlement } from "./customers";

const USER_A = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" };
const USER_B = { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com" };
const WORKFLOW_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKFLOW_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type CustomerRow = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

type EntitlementRow = {
  id: string;
  customer_id: string;
  workflow_id: string;
  status: "active" | "revoked" | "expired";
  source: "free" | "grant";
  starts_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function fakeClient(options: {
  user?: { id: string; email: string } | null;
  customers?: CustomerRow[];
  entitlements?: EntitlementRow[];
  selectError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
}): {
  client: SupabaseClient;
  insertedCustomers: unknown[];
  insertedEntitlements: unknown[];
} {
  const insertedCustomers: unknown[] = [];
  const insertedEntitlements: unknown[] = [];

  const client = {
    auth: {
      getUser: async () => ({ data: { user: options.user ?? null } }),
    },
    from: (table: string) => {
      const state = {
        filters: [] as Array<[string, unknown]>,
      };

      const q = {
        select: () => q,
        eq: (column: string, value: unknown) => {
          state.filters.push([column, value]);
          return q;
        },
        maybeSingle: async () => {
          if (options.selectError) return { data: null, error: options.selectError };
          const rows =
            table === "customers"
              ? (options.customers ?? [])
              : table === "entitlements"
                ? (options.entitlements ?? [])
                : [];
          const row = rows.find((r) => state.filters.every(([column, value]) => r[column as keyof typeof r] === value)) ?? null;
          return { data: row, error: null };
        },
        single: async () => {
          if (options.selectError) return { data: null, error: options.selectError };
          const rows = table === "customers" ? (options.customers ?? []) : [];
          const row = rows.find((r) => state.filters.every(([column, value]) => r[column as keyof typeof r] === value)) ?? null;
          if (!row) return { data: null, error: { code: "PGRST116", message: "0 rows" } };
          return { data: row, error: null };
        },
        insert: (row: unknown) => {
          if (table === "customers") insertedCustomers.push(row);
          if (table === "entitlements") insertedEntitlements.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: row,
                error: options.insertError ?? null,
              }),
            }),
          };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;

  return { client, insertedCustomers, insertedEntitlements };
}

function customerRow(customer: Partial<CustomerRow> & { id: string; email: string }): CustomerRow {
  return {
    display_name: null,
    created_at: "2026-09-21T00:00:00Z",
    updated_at: "2026-09-21T00:00:00Z",
    ...customer,
  };
}

function entitlementRow(entitlement: Partial<EntitlementRow> & { id: string; customer_id: string; workflow_id: string }): EntitlementRow {
  return {
    status: "active",
    source: "free",
    starts_at: "2020-01-01T00:00:00Z",
    expires_at: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    ...entitlement,
  };
}

describe("getOrCreateCustomer", () => {
  test("returns existing customer when already present", async () => {
    const existing = customerRow({ id: USER_A.id, email: USER_A.email, display_name: "Alice" });
    const { client, insertedCustomers } = fakeClient({ user: USER_A, customers: [existing] });

    const result = await getOrCreateCustomer(client, "New Name");

    expect(result).toEqual({ ok: true, customer: existing });
    expect(insertedCustomers).toHaveLength(0);
  });

  test("creates a new customer when not present", async () => {
    const { client, insertedCustomers } = fakeClient({ user: USER_A });

    const result = await getOrCreateCustomer(client, "Alice");

    expect(result.ok).toBe(true);
    expect(insertedCustomers).toHaveLength(1);
    expect(insertedCustomers[0]).toMatchObject({
      id: USER_A.id,
      email: USER_A.email,
      display_name: "Alice",
    });
  });

  test("rejects when there is no authenticated user", async () => {
    const { client, insertedCustomers } = fakeClient({ user: null });
    const result = await getOrCreateCustomer(client);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(insertedCustomers).toHaveLength(0);
  });

  test("maps RLS violation on insert to unauthorized", async () => {
    const { client, insertedCustomers } = fakeClient({
      user: USER_A,
      insertError: { code: "42501", message: "new row violates row-level security policy" },
    });
    const result = await getOrCreateCustomer(client, "Alice");
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(insertedCustomers).toHaveLength(1);
  });

  test("maps duplicate email on insert to error", async () => {
    const { client, insertedCustomers } = fakeClient({
      user: USER_A,
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const result = await getOrCreateCustomer(client, "Alice");
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("error");
    expect(insertedCustomers).toHaveLength(1);
  });
});

describe("getCustomerEntitlement", () => {
  test("returns active entitlement for matching customer and workflow", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
      source: "free",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });

    const result = await getCustomerEntitlement(client, USER_A.id, WORKFLOW_1);

    expect(result).toEqual({ ok: true, entitlement });
  });

  test("returns null when no entitlement exists", async () => {
    const { client } = fakeClient({ user: USER_A, entitlements: [] });
    const result = await getCustomerEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toEqual({ ok: true, entitlement: null });
  });

  test("rejects when caller is not the entitlement owner", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
    });
    const { client } = fakeClient({ user: USER_B, entitlements: [entitlement] });

    const result = await getCustomerEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  test("maps RLS violation to unauthorized", async () => {
    const { client } = fakeClient({
      user: USER_A,
      selectError: { code: "42501", message: "row-level security policy" },
    });
    const result = await getCustomerEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("hasWorkflowEntitlement", () => {
  test("returns true for active entitlement", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(true);
  });

  test("returns false for revoked entitlement", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "revoked",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(false);
  });

  test("returns false for expired entitlement", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
      expires_at: "2020-01-01T00:00:00Z",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(false);
  });

  test("returns false when entitlement is missing", async () => {
    const { client } = fakeClient({ user: USER_A, entitlements: [] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(false);
  });

  test("isolates customer A from customer B entitlements", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
    });
    const { client } = fakeClient({ user: USER_B, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_B.id, WORKFLOW_1);
    expect(result).toBe(false);
  });

  test("distinguishes workflows for the same customer", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_2);
    expect(result).toBe(false);
  });

  test("honors grant source entitlement", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
      source: "grant",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(true);
  });

  test("returns false when entitlement has not started yet", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
      starts_at: "2099-01-01T00:00:00Z",
    });
    const { client } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    const result = await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(result).toBe(false);
  });

  test("does not insert or update entitlements", async () => {
    const entitlement = entitlementRow({
      id: "ent-1",
      customer_id: USER_A.id,
      workflow_id: WORKFLOW_1,
      status: "active",
    });
    const { client, insertedEntitlements } = fakeClient({ user: USER_A, entitlements: [entitlement] });
    await hasWorkflowEntitlement(client, USER_A.id, WORKFLOW_1);
    expect(insertedEntitlements).toHaveLength(0);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("entitlements security policy (migration regression)", () => {
  const migrationPath = resolve(import.meta.dirname, "../../supabase/migrations/20260921000000_customers_and_entitlements.sql");
  const sql = readFileSync(migrationPath, "utf-8");

  test("allows customers to select their own entitlements", () => {
    expect(sql).toContain('create policy "entitlements_select_own"');
    expect(sql).toContain("for select to authenticated using (auth.uid () = customer_id)");
  });

  test("does not allow customers to insert entitlements", () => {
    expect(sql).not.toContain('create policy "entitlements_insert_own"');
    expect(sql).not.toMatch(/grant\s+.*insert.*\s+on\s+public\.entitlements\s+to\s+authenticated/i);
  });

  test("does not allow customers to update entitlements", () => {
    expect(sql).not.toContain('create policy "entitlements_update_own"');
    expect(sql).not.toMatch(/grant\s+.*update.*\s+on\s+public\.entitlements\s+to\s+authenticated/i);
  });

  test("does not allow customers to delete entitlements", () => {
    expect(sql).not.toContain('create policy "entitlements_delete_own"');
    expect(sql).not.toMatch(/grant\s+.*delete.*\s+on\s+public\.entitlements\s+to\s+authenticated/i);
  });

  test("grants only select on entitlements to authenticated", () => {
    expect(sql).toContain("grant select on public.entitlements to authenticated");
  });
});
