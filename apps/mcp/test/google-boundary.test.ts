import { beforeEach, describe, expect, test, vi } from "vitest";

import authSource from "../src/auth.ts?raw";
import serverSource from "../src/server.ts?raw";
import indexSource from "../src/index.ts?raw";
import workflowToolSource from "../src/tools/workflow-tool.ts?raw";

/**
 * Milestone B1 boundary guard.
 *
 * Google provisioning runs in the web app, where an authenticated Supabase
 * session and a one-shot Google access token exist. The MCP Worker authenticates
 * with a Supabase bearer token and holds no Google credential, so it must not
 * provision Google resources until durable per-user Google connections exist.
 */
const SOURCES: { file: string; contents: string }[] = [
  { file: "src/index.ts", contents: indexSource },
  { file: "src/auth.ts", contents: authSource },
  { file: "src/server.ts", contents: serverSource },
  { file: "src/tools/workflow-tool.ts", contents: workflowToolSource },
];

const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /accounts\.google\.com|oauth2\.googleapis\.com/i, reason: "Google OAuth endpoints" },
  { pattern: /www\.googleapis\.com|script\.googleapis\.com/i, reason: "Google data APIs" },
  { pattern: /access_token|refresh_token|GOOGLE_OAUTH/i, reason: "Google credential handling" },
  { pattern: /drive\.google|script\.google/i, reason: "user-owned Google resources" },
];

const fromCalls: string[] = [];

function fakeSupabaseClient() {
  return {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return {
        select: vi.fn(() => ({
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
        })),
      };
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => fakeSupabaseClient()),
}));

describe("MCP Google boundary", () => {
  beforeEach(() => {
    fromCalls.length = 0;
  });

  test("every MCP source file is covered by this guard", () => {
    expect(SOURCES.map((source) => source.file)).toEqual([
      "src/index.ts",
      "src/auth.ts",
      "src/server.ts",
      "src/tools/workflow-tool.ts",
    ]);
    for (const source of SOURCES) expect(source.contents.length).toBeGreaterThan(0);
  });

  test("the MCP Worker never talks to Google on behalf of a user", () => {
    const violations: string[] = [];
    for (const { file, contents } of SOURCES) {
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) violations.push(`${file}: ${reason}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("the MCP Worker only reads published workflows, never a credential store", async () => {
    const { createMcpServer, clearWorkflowCache } = await import("../src/server");
    clearWorkflowCache();

    await createMcpServer({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
    });

    expect([...new Set(fromCalls)]).toEqual(["public_workflows"]);
  });
});
