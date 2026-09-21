import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { createCreatorWithClient } from "./create-creator";

type MockCreator = {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  type: "creator" | "platform";
};

function fakeClient(options: {
  user?: { id: string } | null;
  error?: { code?: string; message?: string } | null;
  data?: MockCreator | null;
}): { client: SupabaseClient; inserted: unknown[] } {
  const inserted: unknown[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: options.user ?? null } }),
    },
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: options.data ?? null,
              error: options.error ?? null,
            }),
          }),
        };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inserted };
}

const USER = { id: "11111111-1111-4111-8111-111111111111" };

describe("createCreatorWithClient", () => {
  test("creates a creator keyed by the authenticated user id", async () => {
    const { client, inserted } = fakeClient({
      user: USER,
      data: {
        id: USER.id,
        slug: "masterdigital",
        display_name: "Master Digital",
        bio: null,
        type: "creator",
      },
    });

    const result = await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });

    expect(result).toEqual({
      ok: true,
      creator: {
        id: USER.id,
        slug: "masterdigital",
        display_name: "Master Digital",
        bio: null,
        type: "creator",
      },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id: USER.id,
      slug: "masterdigital",
      type: "creator",
    });
  });

  test("always inserts the default creator type, never platform", async () => {
    const { client, inserted } = fakeClient({
      user: USER,
      data: {
        id: USER.id,
        slug: "masterdigital",
        display_name: "Master Digital",
        bio: null,
        type: "creator",
      },
    });

    await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ type: "creator" });
  });

  test("rejects when there is no authenticated user", async () => {
    const { client, inserted } = fakeClient({ user: null });
    const result = await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(inserted).toHaveLength(0);
  });

  test("maps a unique violation to taken", async () => {
    const { client } = fakeClient({
      user: USER,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const result = await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });
    expect(result).toEqual({ ok: false, reason: "taken" });
  });

  test("maps an RLS violation to unauthorized", async () => {
    const { client } = fakeClient({
      user: USER,
      error: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    const result = await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  test("maps an unexpected error to error", async () => {
    const { client } = fakeClient({
      user: USER,
      error: { code: "PGRST116", message: "unexpected" },
    });
    const result = await createCreatorWithClient(client, {
      display_name: "Master Digital",
      slug: "masterdigital",
    });
    expect(result).toEqual({
      ok: false,
      reason: "error",
      message: "unexpected",
    });
  });
});