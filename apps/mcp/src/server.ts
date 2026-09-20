import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import {
  buildInputSchemaFromFields,
  WORKFLOW_OUTPUT_SCHEMA,
  createWorkflowToolHandler,
  toolNameFromWorkflowSlug,
  workflowSlugFromToolName,
} from "./tools/workflow-tool.js";

export const SERVER_INFO = {
  name: "permudah-mcp",
  version: "0.1.0",
} as const;

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

export interface WorkflowConfig {
  slug: string;
  name: string;
  description: string | null;
  instructions: string;
  inputFields: Array<{
    name: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    description?: string;
  }>;
}

let cachedWorkflows: WorkflowConfig[] | null = null;

export function clearWorkflowCache(): void {
  cachedWorkflows = null;
}

/**
 * Fetch all published workflows from Supabase public_workflows view.
 * Only workflows with status = published and published_definition IS NOT NULL
 * are returned by the view itself.
 */
async function getWorkflowDefinitions(env: Env): Promise<WorkflowConfig[]> {
  if (cachedWorkflows) return cachedWorkflows;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  const { data, error } = await supabase
    .from("public_workflows")
    .select("id, creator_id, slug, name, description, published_definition, published_at, updated_at");

  if (error || !data) {
    console.error("Failed to fetch published workflows:", error);
    return [];
  }

  const workflows: WorkflowConfig[] = [];
  for (const row of data) {
    const def = row.published_definition as {
      version?: number;
      instructions?: string;
      input?: {
        fields?: Array<{
          name: string;
          type: "string" | "number" | "boolean";
          required: boolean;
          description?: string;
        }>;
      };
    } | null;

    if (!def || !def.instructions) continue;

    workflows.push({
      slug: row.slug,
      name: row.name,
      description: row.description,
      instructions: def.instructions,
      inputFields: def.input?.fields ?? [],
    });
  }

  cachedWorkflows = workflows;
  return workflows;
}

/**
 * Create and fully configure the MCP server with dynamic workflow tools.
 * Each published workflow becomes one MCP tool named after its slug.
 */
export async function createMcpServer(env: Env): Promise<McpServer> {
  const workflows = await getWorkflowDefinitions(env);

  const server = new McpServer(SERVER_INFO);

  if (workflows.length === 0) {
    console.warn("No published workflows found; MCP server will expose no tools.");
  }

  for (const workflow of workflows) {
    const toolName = toolNameFromWorkflowSlug(workflow.slug);
    const inputSchema = buildInputSchemaFromFields(workflow.inputFields);
    const handler = createWorkflowToolHandler(workflow);

    const descriptionParts = [workflow.name];
    if (workflow.description) {
      descriptionParts.push(workflow.description);
    }

    server.registerTool(
      toolName,
      {
        title: workflow.name,
        description: descriptionParts.join(" — "),
        inputSchema,
        outputSchema: WORKFLOW_OUTPUT_SCHEMA,
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        },
      },
      handler
    );
  }

  return server;
}

export { workflowSlugFromToolName };