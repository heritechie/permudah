import { z } from "zod";

function zodTypeFromField(field: {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}): z.ZodTypeAny {
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
export function buildInputSchemaFromFields(fields: Array<{
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
}>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.name] = zodTypeFromField(field);
  }
  return shape;
}

/**
 * Build a zod schema for the output based on the workflow definition.
 * For POC, we use a fixed carousel output structure since we don't have LLM execution.
 */
export const WORKFLOW_OUTPUT_SCHEMA = z.object({
  title: z.string().describe("Judul carousel"),
  slides: z.array(
    z.object({
      slide: z.number().describe("Nomor slide (1-indexed)"),
      headline: z.string().describe("Headline singkat untuk slide"),
      body: z.string().describe("Isi/teks untuk slide"),
    })
  ),
});

export type WorkflowOutput = z.infer<typeof WORKFLOW_OUTPUT_SCHEMA>;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function capitalize(text: string): string {
  const normalized = normalize(text);
  return normalized && /^[a-z]/.test(normalized)
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : normalized;
}

/**
 * Deterministic mock execution based on workflow instructions and input.
 * This replaces the hardcoded carousel logic - it now uses the workflow's
 * instructions as a template guide.
 */
export function executeWorkflow(
  workflowInstructions: string,
  input: Record<string, unknown>
): WorkflowOutput {
  // Extract key variables from input with sensible defaults
  const topic = String(input.topic ?? "Topik");
  const audience = String(input.audience ?? "Audiens");
  const tone = String(input.tone ?? "netral");

  // For POC: deterministic mock that incorporates the workflow instructions
  // In a real implementation, this would call an LLM with the instructions
  const topicC = capitalize(topic);
  const audienceC = capitalize(audience);
  const toneNorm = normalize(tone);

  return {
    title: `${topicC} — ${workflowInstructions.slice(0, 40)}...`,
    slides: [
      {
        slide: 1,
        headline: `Apa itu: ${topicC}?`,
        body: `Mengikuti instruksi workflow: ${workflowInstructions}. Topik: ${topicC}, Audiens: ${audienceC}, Tone: ${toneNorm}.`,
      },
      {
        slide: 2,
        headline: `Kenapa ${audienceC} harus peduli`,
        body: `Workflow menyarankan: ${workflowInstructions}. Poin utama untuk ${audienceC}.`,
      },
      {
        slide: 3,
        headline: "Langkah berikutnya",
        body: `Terapkan ide dari workflow: ${workflowInstructions}. Mulai hari ini.`,
      },
    ],
  };
}

/**
 * Create the tool handler that executes the workflow.
 * This replaces the hardcoded instagramCarouselHandler.
 */
export function createWorkflowToolHandler(workflowInstructions: string) {
  return (input: Record<string, unknown>) => {
    const result = executeWorkflow(workflowInstructions, input);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
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
 * Expected output for test verification (matches mock workflow instructions)
 */
export const MOCK_WORKFLOW_INSTRUCTIONS = "Generate a 3-slide Instagram carousel about the given topic for the target audience using the specified tone.";

export function expectedMockOutput(input: Record<string, unknown>): WorkflowOutput {
  return executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, input);
}