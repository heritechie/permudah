import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Guards the privilege boundary of the Google registry write path.
 *
 * The write is a SECURITY DEFINER Postgres function reached over PostgREST RPC
 * with the caller's own session. There is no elevated credential anywhere in the
 * application, so these tests read the source that would break that property.
 */
const APP_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC_ROOT = join(APP_ROOT, "src");
const REGISTRY = join(SRC_ROOT, "lib/google/registry.ts");
const CALLBACK = join(SRC_ROOT, "app/api/google/callback/route.ts");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) found.push(full);
  }
  return found;
}

const ALL_SOURCE = sourceFiles(SRC_ROOT);

describe("registry write path privilege", () => {
  test("no application source requires or references a service-role credential", () => {
    const offenders = ALL_SOURCE.filter((file) =>
      /SERVICE_ROLE_KEY|service_role/.test(readFileSync(file, "utf8")),
    );

    expect(offenders.map((file) => relative(APP_ROOT, file))).toEqual([]);
  });

  test("no elevated Supabase client module exists", () => {
    // There is no admin client to reach for: the registry writes as the user.
    expect(ALL_SOURCE.map((file) => relative(SRC_ROOT, file))).not.toContain(
      join("lib", "supabase", "service.ts"),
    );
  });

  test("the registry writes through the RPC function, not a table insert", () => {
    const source = readFileSync(REGISTRY, "utf8");

    expect(source).toContain("register_google_web_app");
    expect(source).toMatch(/client\.rpc\(/);
    // A direct table write would need a write grant the browser must never have.
    expect(source).not.toMatch(/\.from\(\s*"google_web_apps"\s*\)/);
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.upsert\(/);
  });

  test("the registry never accepts a user id from the request", () => {
    const source = readFileSync(REGISTRY, "utf8");

    // One input field, documented as session-derived, passed as p_user_id.
    expect(source).toMatch(/p_user_id: input\.userId/);
    expect(source).not.toMatch(/p_user_id:\s*(request|params|query|body|searchParams)/i);
  });

  test("the callback takes the user id from the session and passes its own client", () => {
    const source = readFileSync(CALLBACK, "utf8");

    expect(source).toMatch(/userId: session\.user\.id/);
    expect(source).toMatch(/client: session\.supabase/);
    // The owner must not be re-read from the request anywhere in the handler.
    expect(source).not.toMatch(/userId:\s*(url|request|params|searchParams)/i);
  });

  test("the RPC arguments carry no Google credential", () => {
    const source = readFileSync(REGISTRY, "utf8");
    const rpcArgs = /client\.rpc\([^)]*\{([\s\S]*?)\}/.exec(source)?.[1] ?? "";

    expect(rpcArgs).toMatch(/p_user_id/);
    expect(rpcArgs).not.toMatch(/token|secret|code_verifier|refresh/i);
  });

  test("the admin client is not reachable from any use client module", () => {
    const byPath = new Map(ALL_SOURCE.map((file) => [file, readFileSync(file, "utf8")]));
    const resolveImport = (fromFile: string, specifier: string): string | null => {
      if (specifier.startsWith("@/")) {
        const target = join(SRC_ROOT, `${specifier.slice(2)}.ts`);
        return byPath.has(target) ? target : null;
      }
      if (specifier.startsWith(".")) {
        const target = join(fromFile, "..", specifier);
        return byPath.has(`${target}.ts`) ? `${target}.ts` : null;
      }
      return null;
    };
    const importedBy = (fromFile: string): string[] =>
      [...(byPath.get(fromFile) ?? "").matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)]
        .map((match) => resolveImport(fromFile, match[1]))
        .filter((file): file is string => file !== null);

    const clientEntrypoints = ALL_SOURCE.filter((file) =>
      /^\s*["']use client["']/m.test(byPath.get(file) ?? ""),
    );
    expect(clientEntrypoints.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    const queue = [...clientEntrypoints];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      // Nothing on a client path may reach the registry write module.
      expect(file).not.toBe(REGISTRY);
      queue.push(...importedBy(file));
    }
  });

  test("the browser client still authenticates with the publishable key only", () => {
    const browserClient = readFileSync(join(SRC_ROOT, "lib/supabase/client.ts"), "utf8");

    expect(browserClient).toContain('"use client"');
    expect(browserClient).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(browserClient).not.toMatch(/SERVICE_ROLE|service_role/);
  });
});
