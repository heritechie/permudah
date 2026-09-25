import type { SupabaseClient } from "@supabase/supabase-js";
import { getCreatorByUserId, type StorefrontCreator } from "@/lib/creators";
import { createClient } from "@/lib/supabase/server";

export type CreatorSession = {
  supabase: SupabaseClient;
  user: { id: string };
  creator: StorefrontCreator;
};

export type AuthenticatedSession = {
  supabase: SupabaseClient;
  user: { id: string };
};

/**
 * Server-side authentication guard for flows that only need an authenticated
 * Permudah user (no creator profile required). Identity always comes from the
 * Supabase session cookie, never from the request body or query string.
 */
export async function getAuthenticatedSession(): Promise<AuthenticatedSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, user };
}

/**
 * Server-side session guard for API route handlers. Identity and ownership are
 * always derived from the authenticated session, never from the request body.
 */
export async function getCreatorSession(): Promise<CreatorSession | null> {
  const session = await getAuthenticatedSession();
  if (!session) return null;
  const creator = await getCreatorByUserId(session.user.id);
  if (!creator) return null;
  return { supabase: session.supabase, user: session.user, creator };
}
