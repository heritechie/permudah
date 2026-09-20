import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildInstagramCarousel,
  INSTAGRAM_CAROUSEL_PARAMS,
  INSTAGRAM_CAROUSEL_OUTPUT,
} from "../src/tools/instagram-carousel.js";

const paramsSchema = z.object(INSTAGRAM_CAROUSEL_PARAMS);

const INPUT = {
  topic: "AI untuk UMKM",
  audience: "pemilik toko online",
  tone: "ramah",
};

describe("buildInstagramCarousel", () => {
  it("is deterministic: same input always produces the same output", () => {
    expect(buildInstagramCarousel(INPUT)).toEqual(buildInstagramCarousel(INPUT));
  });

  it("produces a title and exactly 3 slides with slide numbers 1..3", () => {
    const out = buildInstagramCarousel(INPUT);
    expect(out.title).toBe("AI untuk UMKM — panduan ringkas dalam 3 slide");
    expect(out.slides).toHaveLength(3);
    expect(out.slides.map((s) => s.slide)).toEqual([1, 2, 3]);
    for (const slide of out.slides) {
      expect(slide.headline.length).toBeGreaterThan(0);
      expect(slide.body.length).toBeGreaterThan(0);
    }
  });

  it("incorporates topic, audience, and tone into the content", () => {
    const out = buildInstagramCarousel({
      topic: "SEO",
      audience: "penulis blog",
      tone: "energik",
    });
    expect(out.title).toContain("SEO");
    expect(out.slides[1].headline).toContain("Penulis blog");
    expect(out.slides[0].body).toContain("energik");
  });

  it("normalizes leading/trailing whitespace and capitalizes the topic", () => {
    const out = buildInstagramCarousel({
      topic: "  seo  ",
      audience: "penulis blog",
      tone: "ringan",
    });
    expect(out.title).toMatch(/^Seo /);
    expect(out.title).not.toContain("  ");
  });

  it("always satisfies the declared output schema", () => {
    const out = buildInstagramCarousel(INPUT);
    expect(INSTAGRAM_CAROUSEL_OUTPUT.safeParse(out).success).toBe(true);
  });

  it("contains no randomness: repeated serialization is byte-identical", () => {
    const a = JSON.stringify(buildInstagramCarousel(INPUT));
    const b = JSON.stringify(buildInstagramCarousel({ ...INPUT }));
    expect(a).toBe(b);
  });
});

describe("input validation", () => {
  it("accepts valid topic/audience/tone", () => {
    expect(paramsSchema.safeParse(INPUT).success).toBe(true);
  });

  it("rejects missing topic", () => {
    expect(paramsSchema.safeParse({ audience: "x", tone: "y" }).success).toBe(false);
  });

  it("rejects empty audience", () => {
    expect(paramsSchema.safeParse({ topic: "t", audience: "", tone: "y" }).success).toBe(false);
  });

  it("rejects missing tone", () => {
    expect(paramsSchema.safeParse({ topic: "t", audience: "x" }).success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(paramsSchema.safeParse({ topic: 123, audience: "x", tone: "y" }).success).toBe(false);
  });
});