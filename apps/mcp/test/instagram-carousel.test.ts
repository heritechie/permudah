import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildInputSchemaFromFields,
  WORKFLOW_OUTPUT_SCHEMA,
  executeWorkflow,
  expectedMockOutput,
  MOCK_WORKFLOW_INSTRUCTIONS,
  toolNameFromWorkflowSlug,
  workflowSlugFromToolName,
} from "../src/tools/instagram-carousel.js";

const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
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
    // Required fields should not be optional
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

describe("executeWorkflow", () => {
  it("produces deterministic output for the same input", () => {
    const a = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT);
    const b = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT);
    expect(a).toEqual(b);
  });

  it("produces output with title and 3 slides", () => {
    const out = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT);
    expect(out.title).toContain("AI untuk UMKM");
    expect(out.slides).toHaveLength(3);
    expect(out.slides.map((s) => s.slide)).toEqual([1, 2, 3]);
  });

  it("incorporates workflow instructions into the output", () => {
    const out = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT);
    expect(out.slides[0].body).toContain("Mengikuti instruksi workflow");
    expect(out.slides[0].body).toContain(MOCK_WORKFLOW_INSTRUCTIONS.slice(0, 20));
  });

  it("incorporates topic, audience, and tone into the output", () => {
    const out = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, {
      topic: "SEO",
      audience: "penulis blog",
      tone: "energik",
    });
    expect(out.title).toContain("SEO");
    expect(out.slides[0].body).toContain("Penulis blog");
    expect(out.slides[0].body).toContain("energik");
  });

  it("always satisfies the declared output schema", () => {
    const out = executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT);
    expect(WORKFLOW_OUTPUT_SCHEMA.safeParse(out).success).toBe(true);
  });

  it("contains no randomness: repeated serialization is byte-identical", () => {
    const a = JSON.stringify(executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT));
    const b = JSON.stringify(executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, { ...INPUT }));
    expect(a).toBe(b);
  });
});

describe("expectedMockOutput", () => {
  it("matches executeWorkflow with mock instructions", () => {
    expect(expectedMockOutput(INPUT)).toEqual(executeWorkflow(MOCK_WORKFLOW_INSTRUCTIONS, INPUT));
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