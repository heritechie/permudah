import type { SupabaseClient } from "@supabase/supabase-js";

export type Customer = {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Entitlement = {
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

export type GetOrCreateCustomerResult =
  | { ok: true; customer: Customer }
  | { ok: false; reason: "unauthorized" | "error"; message?: string };

export type EntitlementResult =
  | { ok: true; entitlement: Entitlement | null }
  | { ok: false; reason: "unauthorized" | "error"; message?: string };

export async function getOrCreateCustomer(
  client: SupabaseClient,
  displayName?: string | null,
): Promise<GetOrCreateCustomerResult> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return { ok: false, reason: "unauthorized" };
  }

  const existing = await client.from("customers").select("*").eq("id", user.id).maybeSingle();
  if (existing.error) {
    return { ok: false, reason: "error", message: existing.error.message };
  }
  if (existing.data) {
    return { ok: true, customer: existing.data as Customer };
  }

  const email = user.email;
  if (!email) {
    return { ok: false, reason: "error", message: "user has no email" };
  }

  const { data, error } = await client
    .from("customers")
    .insert({
      id: user.id,
      email,
      display_name: displayName ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "42501" || String(error.message).toLowerCase().includes("row-level security")) {
      return { ok: false, reason: "unauthorized" };
    }
    return { ok: false, reason: "error", message: error.message };
  }

  return { ok: true, customer: data as Customer };
}

export async function getCustomerEntitlement(
  client: SupabaseClient,
  customerId: string,
  workflowId: string,
): Promise<EntitlementResult> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.id !== customerId) {
    return { ok: false, reason: "unauthorized" };
  }

  const { data, error } = await client
    .from("entitlements")
    .select("*")
    .eq("customer_id", customerId)
    .eq("workflow_id", workflowId)
    .maybeSingle();

  if (error) {
    if (error.code === "42501" || String(error.message).toLowerCase().includes("row-level security")) {
      return { ok: false, reason: "unauthorized" };
    }
    return { ok: false, reason: "error", message: error.message };
  }

  return { ok: true, entitlement: (data as Entitlement | null) ?? null };
}

export async function hasWorkflowEntitlement(
  client: SupabaseClient,
  customerId: string,
  workflowId: string,
): Promise<boolean> {
  const result = await getCustomerEntitlement(client, customerId, workflowId);
  if (!result.ok) return false;
  if (!result.entitlement) return false;
  if (result.entitlement.status !== "active") return false;

  const now = new Date();
  if (new Date(result.entitlement.starts_at) > now) return false;
  if (result.entitlement.expires_at && new Date(result.entitlement.expires_at) < now) return false;

  return true;
}
