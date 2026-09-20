import type { SupabaseClient } from "@supabase/supabase-js";
import { getCreatorByUserId, type StorefrontCreator } from "@/lib/creators";
import { createClient } from "@/lib/supabase/server";

export type CreatorSession = {
  supabase: SupabaseClient;
  user: { id: string };
  creator: StorefrontCreator;
};

/**
 * Server-side session guard for API route handlers. Identity and ownership are
 * always derived from the authenticated session, never from the request body.
 */
export async function getCreatorSession(): Promise<CreatorSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const creator = await getCreatorByUserId(user.id);
  if (!creator) return null;
  return { supabase, user, creator };
}