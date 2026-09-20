import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  INSTAGRAM_CAROUSEL_PARAMS,
  INSTAGRAM_CAROUSEL_OUTPUT,
  instagramCarouselHandler,
} from "./tools/instagram-carousel.js";

export const SERVER_INFO = {
  name: "permudah-mcp",
  version: "0.1.0",
} as const;

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "generate_instagram_carousel",
    {
      title: "Generate Instagram carousel",
      description:
        "Menghasilkan draf konten Instagram carousel (3 slide) berdasarkan topik, audiens, dan nada penulisan. POC: output deterministik (belum memakai model AI).",
      inputSchema: INSTAGRAM_CAROUSEL_PARAMS,
      outputSchema: INSTAGRAM_CAROUSEL_OUTPUT,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    instagramCarouselHandler
  );

  return server;
}