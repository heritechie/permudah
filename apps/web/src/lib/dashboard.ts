import { getCreatorByUserId, type StorefrontCreator } from "@/lib/creators";
import { createClient } from "@/lib/supabase/server";

export type DashboardGate =
  | { kind: "authenticated"; creator: StorefrontCreator }
  | { kind: "login" }
  | { kind: "onboarding" };

export function decideDashboardGate(
  user: { id: string } | null,
  creator: StorefrontCreator | null,
): DashboardGate {
  if (!user) return { kind: "login" };
  if (!creator) return { kind: "onboarding" };
  return { kind: "authenticated", creator };
}

export async function resolveDashboardGate(): Promise<DashboardGate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const creator = user ? await getCreatorByUserId(user.id) : null;
  return decideDashboardGate(user, creator);
}