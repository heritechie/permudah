import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.js";
import {
  authenticateRequest,
  buildProtectedResourceMetadata,
  createProtectedResourceMetadataResponse,
  createUnauthorizedResponse,
  getProtectedResourceMetadataUrl,
} from "./auth.js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/**
 * Stateless, per-request MCP transport (lihat dokumentasi SDK: stateless mode).
 * Setiap POST mendapat instance transport baru; tidak ada session state.
 * Karena server tidak mengirim notifikasi keluar (server-initiated messages),
 * endpoint GET/SSE dikembalikan 405 — klien (termasuk SDK official) akan
 * fallback ke POST-only.
 *
 * OAuth 2.0 protected resource: semua request ke /mcp wajib menyertakan
 * Authorization: Bearer <access-token> yang valid. Request tanpa token atau
 * dengan token invalid mendapat 401 + protected-resource metadata.
 */
export const workerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);

    // OAuth 2.0 protected resource metadata discovery (RFC 9728).
    if (request.method === "GET" && requestUrl.pathname === "/.well-known/oauth-protected-resource") {
      const metadata = buildProtectedResourceMetadata(requestUrl, env);
      return withCors(createProtectedResourceMetadataResponse(metadata));
    }

    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: CORS_HEADERS });
    }

    const metadata = buildProtectedResourceMetadata(requestUrl, env);
    const resourceMetadataUrl = getProtectedResourceMetadataUrl(requestUrl);

    const authResult = await authenticateRequest(request, env);
    if (!authResult) {
      return withCors(createUnauthorizedResponse(metadata, resourceMetadataUrl.toString()));
    }

    // Create server and load workflow for this request
    const server = await createMcpServer(env);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: false,
    });
    await server.connect(transport);

    const response = await transport.handleRequest(request);
    return withCors(response);
  },
};

export default workerHandler;
