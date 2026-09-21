import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { workerHandler } from "../src/index.js";
import { clearWorkflowCache } from "../src/server.js";
import {
  MOCK_WORKFLOW_INSTRUCTIONS,
  toolNameFromWorkflowSlug,
} from "../src/tools/workflow-tool.js";

const CAROUSEL_SLUG = "instagram-carousel";
const CAROUSEL_TOOL = toolNameFromWorkflowSlug(CAROUSEL_SLUG);

const CAROUSEL_WORKFLOW = {
  id: "wf-carousel",
  creator_id: "creator-a",
  slug: CAROUSEL_SLUG,
  name: "Instagram Carousel Generator",
  description: "Generate Instagram carousel content",
  published_definition: {
    version: 1,
    instructions: MOCK_WORKFLOW_INSTRUCTIONS,
    input: {
      fields: [
        { name: "topic", type: "string", required: true, description: "Topik utama carousel" },
        { name: "audience", type: "string", required: true, description: "Target audiens pembaca carousel" },
        { name: "tone", type: "string", required: false, description: "Nada/gaya penulisan yang diinginkan" },
      ],
    },
  },
  published_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TIPS_WORKFLOW = {
  id: "wf-tips",
  creator_id: "creator-a",
  slug: "financial-tips",
  name: "Financial Tips",
  description: "Daily personal finance tips",
  published_definition: {
    version: 1,
    instructions: "Generate a short personal finance tip for the given audience.",
    input: {
      fields: [
        { name: "topic", type: "string", required: true, description: "Finance topic" },
        { name: "audience", type: "string", required: true, description: "Target audience" },
      ],
    },
  },
  published_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

let mockWorkflows = [CAROUSEL_WORKFLOW, TIPS_WORKFLOW];
let fromCalls: string[] = [];
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

const VALID_ACCESS_TOKEN = "valid-test-token";

function fakeSupabaseClient() {
  return {
    auth: {
      getClaims: vi.fn(async (_jwt: string) => {
        if (_jwt === VALID_ACCESS_TOKEN) {
          return tokenClaimsResult;
        }
        return { data: null, error: { message: "Invalid token" } };
      }),
    },
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return {
        select: vi.fn(() => ({
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: mockWorkflows, error: null }).then(resolve),
        })),
      };
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => fakeSupabaseClient()),
}));

const MCP_URL = new URL("https://mcp.local/mcp");
const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
};

const realFetch = globalThis.fetch;

const TEST_ENV = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
};

beforeEach(() => {
  clearWorkflowCache();
  fromCalls = [];
  mockWorkflows = [CAROUSEL_WORKFLOW, TIPS_WORKFLOW];
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).hostname === "mcp.local") {
        return workerHandler.fetch(req, TEST_ENV);
      }
      return realFetch(input, init);
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function newConnectedClient() {
  const client = new Client({ name: "protocol-test-client", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${VALID_ACCESS_TOKEN}`,
      },
    },
  });
  await client.connect(transport);
  return { client, transport };
}

describe("MCP protocol (official SDK client over HTTP)", () => {
  it("reads published workflows from public_workflows view", async () => {
    const { client } = await newConnectedClient();
    try {
      await client.listTools();
      expect(fromCalls).toContain("public_workflows");
      expect(fromCalls).not.toContain("workflows");
    } finally {
      await client.close();
    }
  });

  it("lists all published workflows as dynamic MCP tools", async () => {
    const { client } = await newConnectedClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(2);
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toEqual([CAROUSEL_TOOL, toolNameFromWorkflowSlug("financial-tips")].sort());
    } finally {
      await client.close();
    }
  });

  it("tool description comes from workflow name/description, not raw instructions", async () => {
    const { client } = await newConnectedClient();
    try {
      const tools = await client.listTools();
      const carousel = tools.tools.find((t) => t.name === CAROUSEL_TOOL);
      expect(carousel).toBeDefined();
      expect(carousel!.description).toContain("Instagram Carousel Generator");
      expect(carousel!.description).not.toContain(MOCK_WORKFLOW_INSTRUCTIONS);
    } finally {
      await client.close();
    }
  });

  it("tool input schema is derived from its workflow definition", async () => {
    const { client } = await newConnectedClient();
    try {
      const tools = await client.listTools();
      const carousel = tools.tools.find((t) => t.name === CAROUSEL_TOOL);
      expect(carousel!.inputSchema.properties).toHaveProperty("topic");
      expect(carousel!.inputSchema.properties).toHaveProperty("audience");
      expect(carousel!.inputSchema.properties).toHaveProperty("tone");
      expect((carousel!.inputSchema.required as string[]).sort()).toEqual(["audience", "topic"]);

      const tips = tools.tools.find((t) => t.name === toolNameFromWorkflowSlug("financial-tips"));
      expect(tips!.inputSchema.properties).toHaveProperty("topic");
      expect(tips!.inputSchema.properties).toHaveProperty("audience");
      expect(tips!.inputSchema.properties).not.toHaveProperty("tone");
    } finally {
      await client.close();
    }
  });

  it("calls the correct tool and returns workflow instructions + input", async () => {
    const { client } = await newConnectedClient();
    try {
      const res = await client.callTool({
        name: CAROUSEL_TOOL,
        arguments: INPUT,
      });
      const content = res.content as Array<{ text?: string }>;
      const text = content[0].text ?? "";
      expect(text).toContain(MOCK_WORKFLOW_INSTRUCTIONS);
      expect(text).toContain(INPUT.topic);
      expect(text).toContain(INPUT.audience);
      expect(text).toContain(INPUT.tone);
      expect(res.structuredContent).toMatchObject({
        workflow: {
          slug: CAROUSEL_SLUG,
          instructions: MOCK_WORKFLOW_INSTRUCTIONS,
        },
        input: INPUT,
      });
    } finally {
      await client.close();
    }
  });

  it("does not list tools when no published workflows exist", async () => {
    mockWorkflows = [];
    const { client } = await newConnectedClient();
    try {
      // When no tools are registered, the server does not advertise the
      // tools capability and tools/list is not available.
      await expect(client.listTools()).rejects.toThrow(/Method not found/i);
    } finally {
      await client.close();
    }
  });

  it("rejects invalid tool arguments at the protocol level", async () => {
    const { client } = await newConnectedClient();
    try {
      const res = await client.callTool({
        name: CAROUSEL_TOOL,
        arguments: { topic: "", audience: "x", tone: "y" },
      });
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain("Invalid arguments");
    } finally {
      await client.close();
    }
  });
});

function parseSSEData(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  return new Response(body).text().then((text) => {
    const messages: unknown[] = [];
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        messages.push(JSON.parse(line.slice(5).trim()));
      }
    }
    return messages;
  });
}

async function postRpc(method: string, params: unknown, token = VALID_ACCESS_TOKEN) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const req = new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const res = await workerHandler.fetch(req, TEST_ENV);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const events = await parseSSEData(res.body!);
  expect(events).toHaveLength(1);
  return events[0]!;
}

describe("MCP protocol (raw Streamable HTTP over SSE)", () => {
  it("answers tools/list without requiring a prior initialize (stateless)", async () => {
    const response = await postRpc("tools/list", {});
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
    });
    const result = (response as { result: { tools: Array<{ name: string }> } }).result;
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([CAROUSEL_TOOL, toolNameFromWorkflowSlug("financial-tips")].sort());
  });

  it("answers tools/call with the workflow execution context", async () => {
    const response = await postRpc("tools/call", {
      name: CAROUSEL_TOOL,
      arguments: INPUT,
    });
    const result = (response as { result: { content: Array<{ text: string }>; structuredContent: unknown } }).result;
    expect(result.content[0].text).toContain(MOCK_WORKFLOW_INSTRUCTIONS);
    expect(result.content[0].text).toContain(INPUT.topic);
    expect(result.structuredContent).toMatchObject({
      workflow: {
        slug: CAROUSEL_SLUG,
        instructions: MOCK_WORKFLOW_INSTRUCTIONS,
      },
      input: INPUT,
    });
  });

  it("rejects invalid tool arguments with an isError result", async () => {
    const response = await postRpc("tools/call", {
      name: CAROUSEL_TOOL,
      arguments: { topic: "", audience: "x", tone: "y" },
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
    });
    const result = (response as { result: { isError: boolean; content: unknown } }).result;
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Invalid arguments");
  });

  it("responds to initialize with the permudah-mcp server info", async () => {
    const response = await postRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "raw-test", version: "0.1.0" },
    });
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "permudah-mcp", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    });
  });

  it("rejects non-POST requests with 405 (no SSE GET endpoint)", async () => {
    const req = new Request(MCP_URL, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(405);
  });

  it("answers OPTIONS preflight with CORS headers", async () => {
    const req = new Request(MCP_URL, { method: "OPTIONS" });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns 401 without Authorization header", async () => {
    const req = new Request(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-test", version: "0.1.0" } },
      }),
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(401);
    const wwwAuth = res.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain("https://test.supabase.co/auth/v1");
    expect(wwwAuth).toContain("https://mcp.local/.well-known/oauth-protected-resource");
  });

  it("returns 401 with malformed Authorization header", async () => {
    const req = new Request(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Basic invalid",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-test", version: "0.1.0" } },
      }),
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const req = new Request(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw-test", version: "0.1.0" } },
      }),
    });
    const res = await workerHandler.fetch(req, TEST_ENV);
    expect(res.status).toBe(401);
  });
});