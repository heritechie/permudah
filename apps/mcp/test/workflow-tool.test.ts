import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildInputSchemaFromFields,
  WORKFLOW_OUTPUT_SCHEMA,
  buildExecutionContext,
  createWorkflowToolHandler,
  MOCK_WORKFLOW_INSTRUCTIONS,
  toolNameFromWorkflowSlug,
  workflowSlugFromToolName,
} from "../src/tools/workflow-tool.js";

const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
};

const WORKFLOW = {
  slug: "instagram-carousel",
  name: "Instagram Carousel Generator",
  description: "Generate Instagram carousel content",
  instructions: MOCK_WORKFLOW_INSTRUCTIONS,
};

const mockFields = [
  { name: "topic", type: "string" as const, required: true, description: "Topik utama carousel" },
  { name: "audience", type: "string" as const, required: true, description: "Target audiens pembaca carousel" },
  { name: "tone", type: "string" as const, required: false, description: "Nada/gaya penulisan yang diinginkan" },
];

describe("buildInputSchemaFromFields", () => {
  it("builds a zod raw shape from workflow input fields", () => {
    const schema = buildInputSchemaFromFields(mockFields);
    expect(schema).toHaveProperty("topic");
    expect(schema).toHaveProperty("audience");
    expect(schema).toHaveProperty("tone");
  });

  it("marks required fields as required and optional fields as optional", () => {
    const schema = buildInputSchemaFromFields(mockFields);
    const topicSchema = schema.topic;
    const toneSchema = schema.tone;
    expect(topicSchema.isOptional?.()).toBe(false);
    expect(toneSchema.isOptional?.()).toBe(true);
  });

  it("includes descriptions in the schema", () => {
    const schema = buildInputSchemaFromFields(mockFields);
    expect(schema.topic.description).toBe("Topik utama carousel");
    expect(schema.audience.description).toBe("Target audiens pembaca carousel");
    expect(schema.tone.description).toBe("Nada/gaya penulisan yang diinginkan");
  });
});

describe("buildExecutionContext", () => {
  it("returns workflow metadata, instructions, and input", () => {
    const context = buildExecutionContext(WORKFLOW, INPUT);
    expect(context).toEqual({
      workflow: {
        slug: WORKFLOW.slug,
        name: WORKFLOW.name,
        description: WORKFLOW.description,
        instructions: WORKFLOW.instructions,
      },
      input: INPUT,
    });
  });

  it("includes the workflow marker in instructions", () => {
    const context = buildExecutionContext(WORKFLOW, INPUT);
    expect(context.workflow.instructions).toContain("WORKFLOW_EXECUTED_V1");
  });

  it("returns different instructions for different workflows", () => {
    const other = buildExecutionContext(
      { ...WORKFLOW, instructions: "Generate a finance tip." },
      INPUT
    );
    expect(other.workflow.instructions).not.toBe(
      buildExecutionContext(WORKFLOW, INPUT).workflow.instructions
    );
  });

  it("satisfies the declared output schema", () => {
    const context = buildExecutionContext(WORKFLOW, INPUT);
    expect(WORKFLOW_OUTPUT_SCHEMA.safeParse(context).success).toBe(true);
  });
});

describe("createWorkflowToolHandler", () => {
  it("returns content containing workflow instructions", () => {
    const handler = createWorkflowToolHandler(WORKFLOW);
    const result = handler(INPUT);
    const text = result.content[0].text;
    expect(text).toContain("WORKFLOW_EXECUTED_V1");
    expect(text).toContain(MOCK_WORKFLOW_INSTRUCTIONS);
  });

  it("returns content containing actual input arguments", () => {
    const handler = createWorkflowToolHandler(WORKFLOW);
    const result = handler(INPUT);
    const text = result.content[0].text;
    expect(text).toContain("AI untuk UMKM");
    expect(text).toContain("pemilik toko online");
    expect(text).toContain("ramah");
  });

  it("returns structured content with workflow and input", () => {
    const handler = createWorkflowToolHandler(WORKFLOW);
    const result = handler(INPUT);
    expect(result.structuredContent).toEqual(buildExecutionContext(WORKFLOW, INPUT));
  });

  it("does not contain hardcoded carousel output", () => {
    const handler = createWorkflowToolHandler(WORKFLOW);
    const result = handler(INPUT);
    const text = result.content[0].text;
    expect(text).not.toContain("Apa itu:");
    expect(text).not.toContain("Langkah berikutnya");
    expect(text).not.toContain("slides");
    expect(result.structuredContent).not.toHaveProperty("title");
    expect(result.structuredContent).not.toHaveProperty("slides");
  });
});

const paramsSchema = z.object(buildInputSchemaFromFields(mockFields));

describe("tool name mapping", () => {
  it("generates deterministic MCP tool name from workflow slug", () => {
    expect(toolNameFromWorkflowSlug("instagram-carousel")).toBe("generate_instagram_carousel");
    expect(toolNameFromWorkflowSlug("financial-tips")).toBe("generate_financial_tips");
  });

  it("resolves workflow slug back from MCP tool name", () => {
    expect(workflowSlugFromToolName("generate_instagram_carousel")).toBe("instagram-carousel");
    expect(workflowSlugFromToolName("generate_financial_tips")).toBe("financial-tips");
  });

  it("returns null for non-prefixed tool names", () => {
    expect(workflowSlugFromToolName("instagram-carousel")).toBeNull();
  });
});

describe("input validation (zod)", () => {
  it("accepts valid topic/audience/tone", () => {
    expect(paramsSchema.safeParse(INPUT).success).toBe(true);
  });

  it("accepts valid input without optional tone", () => {
    expect(paramsSchema.safeParse({ topic: "t", audience: "a" }).success).toBe(true);
  });

  it("rejects missing topic", () => {
    expect(paramsSchema.safeParse({ audience: "x", tone: "y" }).success).toBe(false);
  });

  it("rejects empty audience", () => {
    expect(paramsSchema.safeParse({ topic: "t", audience: "", tone: "y" }).success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(paramsSchema.safeParse({ topic: 123, audience: "x", tone: "y" }).success).toBe(false);
  });
});
