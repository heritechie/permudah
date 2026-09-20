import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, test } from "vitest";
import { checkSlugAvailability } from "./check-slug";

function fakeClient(taken: boolean): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            taken
              ? { data: { slug: "masterdigital" }, error: null }
              : { data: null, error: null },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("checkSlugAvailability", () => {
  test("returns available for a valid free slug", async () => {
    const result = await checkSlugAvailability("masterdigital", fakeClient(false));
    expect(result).toEqual({ available: true });
  });

  test("reports a slug already in use", async () => {
    const result = await checkSlugAvailability("masterdigital", fakeClient(true));
    expect(result).toEqual({ available: false, reason: "taken" });
  });

  test("normalizes input before checking", async () => {
    const result = await checkSlugAvailability("  MasterDigital  ", fakeClient(false));
    expect(result).toEqual({ available: true });
  });

  test("rejects an invalid slug without querying", async () => {
    const result = await checkSlugAvailability("my_creator", fakeClient(false));
    expect(result).toEqual({ available: false, reason: "invalid" });
  });

  test("rejects reserved slugs without querying", async () => {
    const result = await checkSlugAvailability("admin", fakeClient(false));
    expect(result).toEqual({ available: false, reason: "reserved" });
  });
});