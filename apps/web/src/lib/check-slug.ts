import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREATOR_SLUG_PATTERN,
  RESERVED_CREATOR_SLUGS,
  normalizeCreatorSlug,
} from "@/lib/slug";

export type SlugAvailability = {
  available: boolean;
  reason?: "invalid" | "reserved" | "taken";
};

export async function checkSlugAvailability(
  slug: string,
  client: SupabaseClient,
): Promise<SlugAvailability> {
  const normalized = normalizeCreatorSlug(slug);
  if (!normalized || !CREATOR_SLUG_PATTERN.test(normalized)) {
    return { available: false, reason: "invalid" };
  }
  if (RESERVED_CREATOR_SLUGS.has(normalized)) {
    return { available: false, reason: "reserved" };
  }

  const { data } = await client
    .from("creator_storefronts")
    .select("slug")
    .eq("slug", normalized)
    .maybeSingle();

  if (data) {
    return { available: false, reason: "taken" };
  }
  return { available: true };
}