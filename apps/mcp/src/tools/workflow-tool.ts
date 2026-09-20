import { z } from "zod";

export type WorkflowInputField = {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
};

function zodTypeFromField(field: WorkflowInputField): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (field.type) {
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "string":
    default: {
      let strSchema = z.string();
      if (field.required) {
        strSchema = strSchema.min(1, `${field.name} wajib diisi`);
      }
      schema = strSchema;
      break;
    }
  }
  if (field.description) {
    schema = schema.describe(field.description);
  }
  return field.required ? schema : schema.optional();
}

/**
 * Build a zod raw shape from workflow input fields.
 */
export function buildInputSchemaFromFields(fields: WorkflowInputField[]): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = zodTypeFromField(field);
  }
  return shape;
}

export type WorkflowExecutionContext = {
  workflow: {
    slug: string;
    name: string;
    description: string | null;
    instructions: string;
  };
  input: Record<string, unknown>;
};

/**
 * Schema for the prompt-passthrough execution result.
 * MCP does not run an LLM; it returns the workflow instructions and input
 * so ChatGPT can execute the workflow itself.
 */
export const WORKFLOW_OUTPUT_SCHEMA = z.object({
  workflow: z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    instructions: z.string(),
  }),
  input: z.record(z.unknown()),
});

export type WorkflowOutput = z.infer<typeof WORKFLOW_OUTPUT_SCHEMA>;

/**
 * Build the execution context that is passed back to the model.
 * No LLM is invoked here; the MCP server is only an adapter.
 */
export function buildExecutionContext(
  workflow: {
    slug: string;
    name: string;
    description: string | null;
    instructions: string;
  },
  input: Record<string, unknown>
): WorkflowOutput {
  return {
    workflow: {
      slug: workflow.slug,
      name: workflow.name,
      description: workflow.description,
      instructions: workflow.instructions,
    },
    input,
  };
}

function formatExecutionContextForModel(context: WorkflowOutput): string {
  const lines: string[] = [];
  lines.push(`Workflow: ${context.workflow.name}`);
  if (context.workflow.description) {
    lines.push(`Description: ${context.workflow.description}`);
  }
  lines.push("");
  lines.push("Use the following workflow instructions to produce the final output.");
  lines.push("--- WORKFLOW INSTRUCTIONS ---");
  lines.push(context.workflow.instructions);
  lines.push("--- END WORKFLOW INSTRUCTIONS ---");
  lines.push("");
  lines.push("Input arguments:");
  for (const [key, value] of Object.entries(context.input)) {
    lines.push(`- ${key}: ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}

/**
 * Create the tool handler that passes workflow instructions + input back to the model.
 * MCP does not execute an LLM; ChatGPT executes the instructions.
 */
export function createWorkflowToolHandler(workflow: {
  slug: string;
  name: string;
  description: string | null;
  instructions: string;
}) {
  return (input: Record<string, unknown>) => {
    const context = buildExecutionContext(workflow, input);
    return {
      content: [{ type: "text" as const, text: formatExecutionContextForModel(context) }],
      structuredContent: context,
    };
  };
}

/**
 * Deterministic MCP tool name from workflow slug.
 * Example: instagram-carousel -> generate_instagram_carousel
 */
export function toolNameFromWorkflowSlug(slug: string): string {
  return `generate_${slug.replace(/-/g, "_")}`;
}

/**
 * Reverse mapping: MCP tool name -> workflow slug.
 * Example: generate_instagram_carousel -> instagram-carousel
 */
export function workflowSlugFromToolName(toolName: string): string | null {
  const prefix = "generate_";
  if (!toolName.startsWith(prefix)) return null;
  return toolName.slice(prefix.length).replace(/_/g, "-");
}

/**
 * Instructions used by protocol/unit tests to verify prompt passthrough.
 * The marker proves the instruction originates from the workflow definition,
 * not from any hardcoded MCP execution logic.
 */
export const MOCK_WORKFLOW_INSTRUCTIONS =
  "When this workflow is executed, begin the final response with WORKFLOW_EXECUTED_V1. Then generate a 3-slide Instagram carousel about the given topic for the target audience using the specified tone.";
