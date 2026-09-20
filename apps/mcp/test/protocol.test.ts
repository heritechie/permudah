import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { workerHandler } from "../src/index.js";
import { buildInstagramCarousel } from "../src/tools/instagram-carousel.js";

const MCP_URL = new URL("https://mcp.local/mcp");
const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).hostname === "mcp.local") {
        return workerHandler.fetch(req, {});
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
  const transport = new StreamableHTTPClientTransport(MCP_URL);
  await client.connect(transport);
  return { client, transport };
}

describe("MCP protocol (official SDK client over HTTP)", () => {
  it("initializes and lists the generate_instagram_carousel tool", async () => {
    const { client } = await newConnectedClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(1);
      const tool = tools.tools[0]!;
      expect(tool.name).toBe("generate_instagram_carousel");
      expect(tool.description).toContain("Instagram carousel");
      expect(tool.inputSchema.properties).toHaveProperty("topic");
      expect(tool.inputSchema.properties).toHaveProperty("audience");
      expect(tool.inputSchema.properties).toHaveProperty("tone");
      expect((tool.inputSchema.required as string[]).sort()).toEqual([
        "audience",
        "tone",
        "topic",
      ]);
    } finally {
      await client.close();
    }
  });

  it("calls the tool with valid arguments and returns deterministic structured content", async () => {
    const { client } = await newConnectedClient();
    try {
      const res = await client.callTool({
        name: "generate_instagram_carousel",
        arguments: INPUT,
      });
      expect(res.structuredContent).toEqual(buildInstagramCarousel(INPUT));
      expect(JSON.stringify(res.content)).toContain('"type":"text"');
    } finally {
      await client.close();
    }
  });

  it("returns identical results across repeated calls", async () => {
    const { client } = await newConnectedClient();
    try {
      const a = await client.callTool({
        name: "generate_instagram_carousel",
        arguments: INPUT,
      });
      const b = await client.callTool({
        name: "generate_instagram_carousel",
        arguments: INPUT,
      });
      expect(a.structuredContent).toEqual(b.structuredContent);
    } finally {
      await client.close();
    }
  });

  it("rejects invalid tool arguments at the protocol level", async () => {
    const { client } = await newConnectedClient();
    try {
      const res = await client.callTool({
        name: "generate_instagram_carousel",
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

async function postRpc(method: string, params: unknown) {
  const req = new Request(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const res = await workerHandler.fetch(req, {});
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
      result: {
        tools: [{ name: "generate_instagram_carousel" }],
      },
    });
  });

  it("answers tools/call with the deterministic result", async () => {
    const response = await postRpc("tools/call", {
      name: "generate_instagram_carousel",
      arguments: INPUT,
    });
    const result = (response as { result: { structuredContent: unknown } }).result;
    expect(result.structuredContent).toEqual(buildInstagramCarousel(INPUT));
  });

  it("rejects invalid tool arguments with an isError result", async () => {
    const response = await postRpc("tools/call", {
      name: "generate_instagram_carousel",
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
    const res = await workerHandler.fetch(req, {});
    expect(res.status).toBe(405);
  });

  it("answers OPTIONS preflight with CORS headers", async () => {
    const req = new Request(MCP_URL, { method: "OPTIONS" });
    const res = await workerHandler.fetch(req, {});
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});