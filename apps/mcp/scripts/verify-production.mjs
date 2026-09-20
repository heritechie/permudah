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
  const hasInstructions = text.includes("WORKFLOW_EXECUTED_V1");
  const hasInput = text.includes(INPUT.topic) && text.includes(INPUT.audience);
  record(
    "tools/call (valid)",
    Boolean(hasInstructions && hasInput),
    `instructionsPresent=${hasInstructions}, inputPresent=${hasInput}`
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