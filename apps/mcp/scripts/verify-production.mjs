// Verifikasi protocol terhadap endpoint MCP production (bukan unit test).
// Usage: node scripts/verify-production.mjs <URL>
// Contoh: node scripts/verify-production.mjs https://permudah-mcp.<sub>.workers.dev/mcp
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/verify-production.mjs <MCP_URL>");
  process.exit(2);
}

const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
};

const results = {};

function record(name, ok, detail) {
  results[name] = { ok, detail };
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ->  ${detail}` : ""}`);
}

const client = new Client({ name: "verify-production", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(url);

try {
  // Verify unauthenticated requests are rejected with 401 + OAuth metadata.
  const unauthRes = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "verify", version: "0.1.0" } },
    }),
  });
  record(
    "unauthenticated /mcp",
    unauthRes.status === 401,
    `status=${unauthRes.status}, www-authenticate=${unauthRes.headers.get("WWW-Authenticate")?.slice(0, 80)}`
  );

  await client.connect(transport);
  record("initialize/connect", true, "SDK Client terhubung via Streamable HTTP");

  const tools = await client.listTools();
  const tool = tools.tools.find((t) => t.name === "generate_instagram_carousel");
  record(
    "tools/list",
    Boolean(tool),
    tool ? `ditemukan ${tools.tools.length} tool: ${tools.tools.map((t) => t.name).join(", ")}` : "tool tidak ditemukan"
  );
  if (!tool) {
    throw new Error("generate_instagram_carousel missing");
  }

  const res = await client.callTool({ name: "generate_instagram_carousel", arguments: INPUT });
  const text = res.content?.[0]?.text ?? "";
  const instructions = res.structuredContent?.workflow?.instructions ?? "";
  const hasInstructions = instructions.length > 0 && text.includes(instructions);
  const hasInput = text.includes(INPUT.topic) && text.includes(INPUT.audience);
  record(
    "tools/call (valid)",
    Boolean(hasInstructions && hasInput),
    `instructionsPresent=${hasInstructions}, inputPresent=${hasInput}, instructionsLength=${instructions.length}`
  );

  const bad = await client.callTool({
    name: "generate_instagram_carousel",
    arguments: { topic: "", audience: "x", tone: "y" },
  });
  record("tools/call (invalid)", bad.isError === true, `isError=${bad.isError}`);

  await client.close();
} catch (err) {
  record("initialize/connect", false, String(err && err.message ? err.message : err));
  process.exitCode = 1;
}

const allPass = Object.values(results).every((r) => r.ok);
console.log(allPass ? "\nALL PASS" : "\nSOME FAILED");
process.exitCode = allPass ? 0 : 1;