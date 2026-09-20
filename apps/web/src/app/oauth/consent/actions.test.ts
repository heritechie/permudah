import { describe, expect, test, vi } from "vitest";
import { approveAuthorizationAction, denyAuthorizationAction } from "./actions";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");

function fakeSupabase(oauth: {
  approveAuthorization?: { redirect_url: string } | null;
  denyAuthorization?: { redirect_url: string } | null;
  error?: { message: string } | null;
}) {
  return {
    auth: {
      oauth: {
        approveAuthorization: vi.fn(async () => ({
          data: oauth.approveAuthorization ?? null,
          error: oauth.error ?? null,
        })),
        denyAuthorization: vi.fn(async () => ({
          data: oauth.denyAuthorization ?? null,
          error: oauth.error ?? null,
        })),
      },
    },
  };
}

describe("approveAuthorizationAction", () => {
  test("returns redirect_url on success", async () => {
    const supabase = fakeSupabase({ approveAuthorization: { redirect_url: "https://app.com/callback?code=abc" } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await approveAuthorizationAction("authz-1");

    expect(result).toEqual({ ok: true, redirect_url: "https://app.com/callback?code=abc" });
    expect(supabase.auth.oauth.approveAuthorization).toHaveBeenCalledWith("authz-1");
  });

  test("returns error when approval fails", async () => {
    const supabase = fakeSupabase({ error: { message: "Authorization not found" } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await approveAuthorizationAction("authz-1");

    expect(result).toEqual({ ok: false, error: "Authorization not found" });
  });
});

describe("denyAuthorizationAction", () => {
  test("returns redirect_url on success", async () => {
    const supabase = fakeSupabase({ denyAuthorization: { redirect_url: "https://app.com/callback?error=denied" } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await denyAuthorizationAction("authz-1");

    expect(result).toEqual({ ok: true, redirect_url: "https://app.com/callback?error=denied" });
    expect(supabase.auth.oauth.denyAuthorization).toHaveBeenCalledWith("authz-1");
  });

  test("returns error when denial fails", async () => {
    const supabase = fakeSupabase({ error: { message: "Authorization not found" } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const result = await denyAuthorizationAction("authz-1");

    expect(result).toEqual({ ok: false, error: "Authorization not found" });
  });
});
