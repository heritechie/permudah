import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";

interface Env {}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

/**
 * Stateless, per-request MCP transport (lihat dokumentasi SDK: stateless mode).
 * Setiap POST mendapat instance transport baru; tidak ada session state.
 * Karena server tidak mengirim notifikasi keluar (server-initiated messages),
 * endpoint GET/SSE dikembalikan 405 — klien (termasuk SDK official) akan
 * fallback ke POST-only.
 */
export const workerHandler = {
  async fetch(request: Request, _env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: CORS_HEADERS });
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: false,
    });
    const server = createMcpServer();
    await server.connect(transport);

    const response = await transport.handleRequest(request);
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(name, value);
    }
    return response;
  },
};

export default workerHandler;