import { z } from "zod";

export const INSTAGRAM_CAROUSEL_PARAMS = {
  topic: z
    .string()
    .min(1, "topic wajib diisi")
    .max(200)
    .describe("Topik utama carousel"),
  audience: z
    .string()
    .min(1, "audience wajib diisi")
    .max(200)
    .describe("Target audiens pembaca carousel"),
  tone: z
    .string()
    .min(1, "tone wajib diisi")
    .max(100)
    .describe("Nada/gaya penulisan yang diinginkan"),
};

export const INSTAGRAM_CAROUSEL_OUTPUT = z.object({
  title: z.string().describe("Judul carousel"),
  slides: z.array(
    z.object({
      slide: z.number().describe("Nomor slide (1-indexed)"),
      headline: z.string().describe("Headline singkat untuk slide"),
      body: z.string().describe("Isi/teks untuk slide"),
    })
  ),
});

export type InstagramCarouselInput = {
  topic: string;
  audience: string;
  tone: string;
};

export type InstagramCarouselOutput = z.infer<typeof INSTAGRAM_CAROUSEL_OUTPUT>;

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function capitalize(text: string): string {
  const normalized = normalize(text);
  return normalized && /^[a-z]/.test(normalized)
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : normalized;
}

export function buildInstagramCarousel(
  input: InstagramCarouselInput
): InstagramCarouselOutput {
  const topic = capitalize(input.topic);
  const audience = capitalize(input.audience);
  const tone = normalize(input.tone);

  return {
    title: `${topic} — panduan ringkas dalam 3 slide`,
    slides: [
      {
        slide: 1,
        headline: `Apa itu: ${topic}?`,
        body: `Dalam 1 menit, pahami intisari ${topic} dan kenapa hal ini relevan untuk ${audience}. Ditulis dengan nada ${tone}.`,
      },
      {
        slide: 2,
        headline: `Kenapa ${audience} harus peduli`,
        body: `Satu poin utama yang membuat ${topic} berdampak langsung untuk ${audience}. Simpan slide ini untuk dibagikan.`,
      },
      {
        slide: 3,
        headline: "Langkah berikutnya",
        body: `Mulai dari hal kecil: terapkan satu ide dari carousel ini hari ini, lalu bagikan hasilnya kepada ${audience}.`,
      },
    ],
  };
}

export function instagramCarouselHandler(input: InstagramCarouselInput) {
  const result = buildInstagramCarousel(input);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}