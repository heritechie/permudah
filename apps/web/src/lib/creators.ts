import { createClient } from "@/lib/supabase/server";
import { parseHostname } from "@/lib/hostname";

export type StorefrontCreator = {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
};

export async function getCreatorBySlug(
  slug: string,
): Promise<StorefrontCreator | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("creator_storefronts")
      .select("id, slug, display_name, bio, avatar_url")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function getCreatorForHostname(
  hostname: string,
): Promise<StorefrontCreator | null> {
  const hostInfo = parseHostname(hostname);
  if (hostInfo.kind !== "creator") return null;
  return getCreatorBySlug(hostInfo.slug);
}