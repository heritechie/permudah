import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Access-control guard for the Google Web App registry migrations.
 *
 * There is no database in the unit test environment, so these assertions read
 * the SQL that will run. They fail the build if a later edit adds a client write
 * policy, grants a credential, or loosens the SECURITY DEFINER function.
 */
const MIGRATIONS = {
  table: fileURLToPath(
    new URL("../../../supabase/migrations/20260925120000_google_web_app_registry.sql", import.meta.url),
  ),
  function: fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260925130000_register_google_web_app_function.sql",
      import.meta.url,
    ),
  ),
};

const tableSql = readFileSync(MIGRATIONS.table, "utf8");
const functionSql = readFileSync(MIGRATIONS.function, "utf8");

describe("google_web_apps table migration", () => {
  test("creates the registry table with the expected columns", () => {
    expect(tableSql).toContain("create table if not exists public.google_web_apps");
    for (const column of [
      "user_id uuid not null references auth.users (id) on delete cascade",
      "spreadsheet_id text not null",
      "script_id text not null",
      "deployment_id text not null",
      "web_app_url text not null",
      "owner_email text not null",
      "status text not null default 'active'",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(tableSql).toContain(column);
    }
  });

  test("constrains status to the allowed set", () => {
    expect(tableSql).toContain(
      "constraint google_web_apps_status_check check (status in ('active', 'failed', 'disabled'))",
    );
  });

  test("enables row level security", () => {
    expect(tableSql).toContain("alter table public.google_web_apps enable row level security");
  });

  test("lets a user read only their own rows", () => {
    expect(tableSql).toContain('create policy "google_web_apps_select_own" on public.google_web_apps');
    expect(tableSql).toContain("for select to authenticated using (auth.uid () = user_id)");
  });

  test("never grants a client write privilege", () => {
    expect(tableSql).toContain("revoke all on public.google_web_apps from anon, authenticated");
    expect(tableSql).toContain("grant select on public.google_web_apps to authenticated");

    // No policy may allow a client to write.
    expect(tableSql).not.toMatch(/for insert to (anon|authenticated)/);
    expect(tableSql).not.toMatch(/for update to (anon|authenticated)/);
    expect(tableSql).not.toMatch(/for delete to (anon|authenticated)/);
    expect(tableSql).not.toMatch(/for all to (anon|authenticated)/);

    // No write privilege for client roles, in any form.
    expect(tableSql).not.toMatch(
      /grant[^;]*\b(insert|update|delete|all)\b[^;]*to (anon|authenticated)/,
    );
  });

  test("grants nothing to service_role", () => {
    // A service-role key bypasses RLS on every table, so the registry must not
    // depend on one. If this ever needs a credential, that is a design change.
    expect(tableSql).not.toMatch(/grant[^;]*to service_role/);
    expect(functionSql).not.toMatch(/grant[^;]*to service_role/);
  });

  test("stores no Google credential", () => {
    expect(tableSql).not.toMatch(/access_token|refresh_token|authorization_code|client_secret/);
  });
});

describe("register_google_web_app function migration", () => {
  /** The PL/pgSQL body only, with comments stripped, so prose cannot satisfy a check. */
  const body = (() => {
    const match = /as \$\$\n([\s\S]*?)\n\$\$;/.exec(functionSql);
    if (!match) throw new Error("could not locate the function body");
    return match[1].replace(/--[^\n]*/g, "");
  })();

  test("is a SECURITY DEFINER function with the required signature", () => {
    expect(functionSql).toContain("create or replace function public.register_google_web_app(");
    for (const parameter of [
      "p_user_id uuid",
      "p_spreadsheet_id text",
      "p_script_id text",
      "p_deployment_id text",
      "p_web_app_url text",
      "p_owner_email text",
      "p_status text",
    ]) {
      expect(functionSql).toContain(parameter);
    }
    expect(functionSql).toContain("security definer");
    expect(functionSql).toContain("language plpgsql");
  });

  test("pins an explicit safe search_path", () => {
    // pg_temp is listed explicitly and last so a caller's temporary objects
    // cannot shadow the target table.
    expect(functionSql).toContain("set search_path = public, pg_temp");
    expect(functionSql).not.toMatch(/set search_path\s*=\s*$/m);
  });

  test("verifies the caller is authenticated and is the owner", () => {
    expect(body).toContain("auth.uid()");
    expect(body).toMatch(/if v_user_id is null then[\s\S]{0,200}raise exception/);
    expect(body).toContain("p_user_id is distinct from v_user_id");
    // The INSERT uses the verified uid, not the caller's argument.
    expect(body).toContain("values (\n    v_user_id,");
  });

  test("performs exactly one insert and no other write", () => {
    expect(body.match(/insert into/gi)).toHaveLength(1);
    expect(body).toContain("insert into public.google_web_apps");
    expect(body).not.toMatch(/\bupdate\b/i);
    expect(body).not.toMatch(/\bdelete\b/i);
    expect(body).not.toMatch(/\btruncate\b/i);
  });

  test("performs no select", () => {
    expect(body).not.toMatch(/\bselect\b/i);
  });

  test("uses no dynamic SQL", () => {
    // `execute` would let a caller aim the function at another statement.
    expect(body).not.toMatch(/\bexecute\b/i);
    expect(body).not.toMatch(/\bformat\s*\(/i);
    expect(body).not.toMatch(/\bquote_ident\b|\bquote_literal\b/i);
  });

  test("revokes EXECUTE from PUBLIC and grants it only to authenticated", () => {
    const signature =
      "public.register_google_web_app(uuid, text, text, text, text, text, text)";
    expect(functionSql).toContain(`revoke all on function ${signature} from public`);
    expect(functionSql).toContain(`grant execute on function ${signature} to authenticated`);

    // No other role receives EXECUTE, and no role receives table writes.
    const grants = [...functionSql.matchAll(/grant\s+([^;]+?)\s+on\s+function[^;]+?to\s+([^;]+);/gi)];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, privilege, role] of grants) {
      expect(privilege.trim().toLowerCase()).toBe("execute");
      expect(role.trim().toLowerCase()).toBe("authenticated");
    }
  });

  test("grants no table write privilege to any client role", () => {
    expect(functionSql).toContain("revoke insert, update, delete on public.google_web_apps from anon, authenticated");
    expect(functionSql).not.toMatch(/grant\s+(insert|update|delete)[^;]*to\s+(anon|authenticated)/i);
  });

  test("adds no browser write policy", () => {
    expect(functionSql).not.toMatch(/create policy/i);
    expect(functionSql).not.toMatch(/alter table[\s\S]{0,60}disable row level security/i);
  });
});
