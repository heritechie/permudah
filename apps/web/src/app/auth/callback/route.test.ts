import { describe, expect, test, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");

function fakeSupabase(user: { id: string } | null) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ error: null })),
      getUser: vi.fn(async () => ({ data: { user } })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn(async () => ({ data: null })),
        }),
      }),
    }),
  };
}

describe("auth callback", () => {
  test("rejects external redirect URLs", async () => {
    const supabase = fakeSupabase({ id: "user-1" });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const request = new Request("https://permudah.com/auth/callback?code=abc&redirect=https://evil.com");
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).not.toContain("evil.com");
    expect(location).toMatch(/^https:\/\/permudah\.com\//);
  });

  test("allows internal redirect paths", async () => {
    const supabase = fakeSupabase({ id: "user-1" });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const request = new Request(
      "https://permudah.com/auth/callback?code=abc&redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dxyz",
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    const location = response.headers.get("location");
    expect(location).toBe("https://permudah.com/oauth/consent?authorization_id=xyz");
  });
});
