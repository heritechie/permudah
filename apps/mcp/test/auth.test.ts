import { beforeEach, describe, expect, test, vi } from "vitest";
import { workerHandler } from "../src/index.js";
import { clearWorkflowCache } from "../src/server.js";

const VALID_ACCESS_TOKEN = "valid-test-token";
const TEST_ENV = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
};

let tokenClaimsResult: { data: unknown | null; error: unknown | null } = {
  data: {
    claims: {
      iss: "https://test.supabase.co/auth/v1",
      aud: "authenticated",
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
  },
  error: null,
};

function fakeSupabaseClient() {
  return {
    auth: {
      getClaims: vi.fn(async (_jwt: string) => {
        if (_jwt !== VALID_ACCESS_TOKEN) {
          return { data: null, error: { message: "Invalid token" } };
        }
        if (tokenClaimsResult.data && typeof tokenClaimsResult.data === "object" && "claims" in tokenClaimsResult.data) {
          const claims = (tokenClaimsResult.data as { claims: { exp: number } }).claims;
          if (claims.exp < Math.floor(Date.now() / 1000)) {
            return { data: null, error: { message: "Token expired" } };
          }
        }
        return tokenClaimsResult;
      }),
    },
    from: () => ({
      select: () => ({
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }),
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => fakeSupabaseClient()),
}));

function makeRequest(token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return new Request("https://mcp.local/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "auth-test", version: "0.1.0" },
      },
    }),
  });
}

describe("MCP OAuth authentication", () => {
  beforeEach(() => {
    clearWorkflowCache();
    tokenClaimsResult = {
      data: {
        claims: {
          iss: "https://test.supabase.co/auth/v1",
          aud: "authenticated",
          sub: "user-1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    };
  });

  test("unauthenticated request returns 401 with OAuth metadata pointing to well-known endpoint", async () => {
    const res = await workerHandler.fetch(makeRequest(), TEST_ENV);
    expect(res.status).toBe(401);

    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain("https://test.supabase.co/auth/v1");
    expect(wwwAuth).toContain("https://mcp.local/.well-known/oauth-protected-resource");

    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("unauthorized");
  });

  test("GET /.well-known/oauth-protected-resource returns metadata JSON", async () => {
    const req = new Request("https://mcp.local/.well-known/oauth-protected-resource", {
      method: "GET",
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const metadata = (await res.json()) as {
      resource?: string;
      authorization_servers?: string[];
      scopes_supported?: string[];
      bearer_methods_supported?: string[];
    };
    expect(metadata.resource).toBe("https://mcp.local/mcp");
    expect(metadata.authorization_servers).toEqual(["https://test.supabase.co/auth/v1"]);
    expect(metadata.scopes_supported).toContain("openid");
    expect(metadata.bearer_methods_supported).toContain("header");
  });

  test("GET /mcp remains 405", async () => {
    const req = new Request("https://mcp.local/mcp", { method: "GET" });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(405);
  });

  test("valid token allows request", async () => {
    const res = await workerHandler.fetch(makeRequest(VALID_ACCESS_TOKEN), TEST_ENV);
    expect(res.status).toBe(200);
  });

  test("expired token returns 401", async () => {
    tokenClaimsResult = {
      data: {
        claims: {
          iss: "https://test.supabase.co/auth/v1",
          aud: "authenticated",
          sub: "user-1",
          exp: Math.floor(Date.now() / 1000) - 3600,
        },
      },
      error: null,
    };
    const res = await workerHandler.fetch(makeRequest(VALID_ACCESS_TOKEN), TEST_ENV);
    expect(res.status).toBe(401);
  });

  test("token with wrong issuer returns 401", async () => {
    tokenClaimsResult = {
      data: {
        claims: {
          iss: "https://evil.supabase.co/auth/v1",
          aud: "authenticated",
          sub: "user-1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    };
    const res = await workerHandler.fetch(makeRequest(VALID_ACCESS_TOKEN), TEST_ENV);
    expect(res.status).toBe(401);
  });

  test("token with wrong audience returns 401", async () => {
    tokenClaimsResult = {
      data: {
        claims: {
          iss: "https://test.supabase.co/auth/v1",
          aud: "anonymous",
          sub: "user-1",
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      },
      error: null,
    };
    const res = await workerHandler.fetch(makeRequest(VALID_ACCESS_TOKEN), TEST_ENV);
    expect(res.status).toBe(401);
  });

  test("malformed Authorization header returns 401", async () => {
    const req = new Request("https://mcp.local/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "NotBearer token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "auth-test", version: "0.1.0" },
        },
      }),
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(401);
  });
});
