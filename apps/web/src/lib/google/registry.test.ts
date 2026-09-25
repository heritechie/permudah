import { afterEach, describe, expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordProvisionedGoogleWebApp } from "@/lib/google/registry";

const VALID_INPUT = {
  userId: "user-1",
  spreadsheetId: "sheet-1",
  scriptId: "script-1",
  deploymentId: "AKfycb_abc",
  webAppUrl: "https://script.google.com/macros/s/abc/exec",
  ownerEmail: "creator@example.com",
  correlationId: "corr-1",
};

const ROW_ID = "11111111-1111-1111-1111-111111111111";

type RpcResult = { data?: unknown; error?: { message: string; code?: string } | null };

/** Minimal Supabase double that records the RPC name and its arguments. */
function fakeClient(result: RpcResult = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { data: "data" in result ? result.data : ROW_ID, error: result.error ?? null };
  });
  const client = { rpc } as unknown as SupabaseClient;
  return { client, calls, rpc };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordProvisionedGoogleWebApp", () => {
  test("writes through the SECURITY DEFINER rpc, not a table insert", async () => {
    const { client, calls } = fakeClient();

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(result).toEqual({ ok: true, id: ROW_ID, correlationId: "corr-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("register_google_web_app");
  });

  test("passes the session-derived user id and the provisioned resource ids", async () => {
    const { client, calls } = fakeClient();

    await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(calls[0].args).toEqual({
      p_user_id: "user-1",
      p_spreadsheet_id: "sheet-1",
      p_script_id: "script-1",
      p_deployment_id: "AKfycb_abc",
      p_web_app_url: "https://script.google.com/macros/s/abc/exec",
      p_owner_email: "creator@example.com",
      p_status: "active",
    });
  });

  test("uses the caller's own client rather than any elevated credential", async () => {
    const { client, rpc } = fakeClient();

    await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    // A direct table write would bypass the database owner check.
    expect(rpc).toHaveBeenCalledTimes(1);
    const clientAsRecord = client as unknown as Record<string, unknown>;
    expect(clientAsRecord.from).toBeUndefined();
  });

  test("never sends a Google credential to the database", async () => {
    const { client, calls } = fakeClient();

    await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    const serialized = JSON.stringify(calls[0].args);
    expect(serialized).not.toMatch(/token|secret|refresh|authorization_code/i);
  });

  test("fails closed when no authenticated client is available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client: null });

    expect(result).toMatchObject({
      ok: false,
      reason: "registry_not_configured",
      correlationId: "corr-1",
    });
  });

  test("reports a write failure instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ error: { message: "connection terminated" } });

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(result).toMatchObject({ ok: false, reason: "registry_write_failed" });
  });

  test("does not leak the database message to the caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      error: { message: 'relation "public.google_web_apps" does not exist', code: "42P01" },
    });

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(result.ok).toBe(false);
    // The browser only ever sees a fixed reason; internals stay in the log.
    expect(JSON.stringify(result)).not.toContain("google_web_apps");
  });

  test("logs the database error server-side, sanitized", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    const { client } = fakeClient({ error: { message: "rejected ya29.SECRET-TOKEN" } });

    await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    const logged = logs.join("\n");
    expect(logged).toContain("google_registry_write_failed");
    expect(logged).not.toContain("SECRET-TOKEN");
  });

  test("flags an owner mismatch without exposing it to the browser", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    const { client } = fakeClient({
      error: {
        message: "user id does not match the authenticated user",
        code: "42501",
      },
    });

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(result).toMatchObject({ ok: false, reason: "registry_write_failed" });
    expect(JSON.stringify(result)).not.toContain("authenticated user");
    expect(logs.join("\n")).toContain("identity_rejected");
  });

  test("refuses a web app URL that is not a Google Apps Script URL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, rpc } = fakeClient();

    const result = await recordProvisionedGoogleWebApp(
      { ...VALID_INPUT, webAppUrl: "https://attacker.example.com/steal" },
      { client },
    );

    expect(result).toMatchObject({ ok: false, reason: "registry_write_failed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  test("rejects an empty or oversized value before calling the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, rpc } = fakeClient();

    const empty = await recordProvisionedGoogleWebApp({ ...VALID_INPUT, scriptId: "" }, { client });
    const huge = await recordProvisionedGoogleWebApp(
      { ...VALID_INPUT, ownerEmail: `${"a".repeat(600)}@example.com` },
      { client },
    );

    expect(empty.ok).toBe(false);
    expect(huge.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("treats a missing row id as a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: null });

    const result = await recordProvisionedGoogleWebApp(VALID_INPUT, { client });

    expect(result).toMatchObject({ ok: false, reason: "registry_write_failed" });
  });
});
