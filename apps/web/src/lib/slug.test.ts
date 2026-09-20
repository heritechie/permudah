import { describe, expect, test } from "vitest";
import {
  RESERVED_CREATOR_SLUGS,
  creatorStorefrontUrl,
  normalizeCreatorSlug,
  resolvePostAuthDestination,
  validateCreatorSlug,
} from "./slug";

describe("normalizeCreatorSlug", () => {
  test("lowercases and trims", () => {
    expect(normalizeCreatorSlug("  MasterDigital  ")).toBe("masterdigital");
    expect(normalizeCreatorSlug("MY-CREATOR")).toBe("my-creator");
  });
});

describe("validateCreatorSlug", () => {
  test("accepts valid slugs", () => {
    for (const slug of ["masterdigital", "a", "my-creator", "my-creator-2", "9slug"]) {
      expect(validateCreatorSlug(slug)).toEqual({ ok: true, slug });
    }
  });

  test("normalizes before validating", () => {
    expect(validateCreatorSlug("  MY-CREATOR  ")).toEqual({
      ok: true,
      slug: "my-creator",
    });
  });

  test("rejects empty slug", () => {
    expect(validateCreatorSlug("") ).toEqual({ ok: false, reason: "required" });
    expect(validateCreatorSlug("   ")).toEqual({ ok: false, reason: "required" });
  });

  test("rejects invalid characters and edge hyphens", () => {
    for (const slug of [
      "-masterdigital",
      "masterdigital-",
      "my_creator",
      "my.creator",
      "my creator",
      "master$digital",
    ]) {
      expect(validateCreatorSlug(slug)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  test("rejects reserved slugs", () => {
    for (const slug of RESERVED_CREATOR_SLUGS) {
      expect(validateCreatorSlug(slug)).toEqual({
        ok: false,
        reason: "reserved",
      });
    }
  });
});

describe("creatorStorefrontUrl", () => {
  test("uses the app root domain by default", () => {
    expect(creatorStorefrontUrl("masterdigital")).toBe(
      "https://masterdigital.permudah.com",
    );
  });

  test("maps localhost to a local subdomain", () => {
    expect(creatorStorefrontUrl("masterdigital", "http://localhost:3000")).toBe(
      "http://masterdigital.localhost:3000",
    );
    expect(creatorStorefrontUrl("masterdigital", "http://localhost")).toBe(
      "http://masterdigital.localhost",
    );
  });

  test("ignores remote origins", () => {
    expect(
      creatorStorefrontUrl("masterdigital", "https://permudah.com"),
    ).toBe("https://masterdigital.permudah.com");
  });
});

describe("resolvePostAuthDestination", () => {
  test("no creator redirects to creator onboarding", () => {
    expect(resolvePostAuthDestination(null, "https://permudah.com")).toBe(
      "https://permudah.com/onboarding/creator",
    );
  });

  test("existing creator redirects to their storefront", () => {
    expect(
      resolvePostAuthDestination({ slug: "masterdigital" }, "https://permudah.com"),
    ).toBe("https://masterdigital.permudah.com");
  });

  test("existing creator on local dev goes to local storefront", () => {
    expect(
      resolvePostAuthDestination({ slug: "masterdigital" }, "http://localhost:3000"),
    ).toBe("http://masterdigital.localhost:3000");
  });
});