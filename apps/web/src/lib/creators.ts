import { createClient } from "@/lib/supabase/server";
import { parseHostname } from "@/lib/hostname";
import type { CreatorType } from "@/lib/creator-type";

export type {
  CreatorType,
} from "@/lib/creator-type";
export {
  CREATOR_TYPES,
  DEFAULT_CREATOR_TYPE,
  isCreatorType,
  PLATFORM_PUBLISHER,
} from "@/lib/creator-type";

export type StorefrontCreator = {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  type: CreatorType;
};

export async function getCreatorBySlug(
  slug: string,
): Promise<StorefrontCreator | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("creator_storefronts")
      .select("id, slug, display_name, bio, avatar_url, type")
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

export async function getCreatorByUserId(
  userId: string,
): Promise<StorefrontCreator | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("creator_storefronts")
      .select("id, slug, display_name, bio, avatar_url, type")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}