import type { SupabaseClient } from "@supabase/supabase-js";

export type CreateCreatorInput = {
  display_name: string;
  slug: string;
  bio?: string | null;
};

export type CreateCreatorResult =
  | {
      ok: true;
      creator: {
        id: string;
        slug: string;
        display_name: string;
        bio: string | null;
      };
    }
  | { ok: false; reason: "unauthorized" | "taken" | "error"; message?: string };

export async function createCreatorWithClient(
  client: SupabaseClient,
  input: CreateCreatorInput,
): Promise<CreateCreatorResult> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return { ok: false, reason: "unauthorized" };
  }

  const { data, error } = await client
    .from("creators")
    .insert({
      id: user.id,
      slug: input.slug,
      display_name: input.display_name,
      bio: input.bio ?? null,
    })
    .select("id, slug, display_name, bio")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, reason: "taken" };
    }
    if (
      error.code === "42501" ||
      String(error.message).toLowerCase().includes("row-level security")
    ) {
      return { ok: false, reason: "unauthorized" };
    }
    return { ok: false, reason: "error", message: error.message };
  }

  return { ok: true, creator: data };
}