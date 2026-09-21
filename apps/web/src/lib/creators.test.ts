import { describe, expect, test } from "vitest";
import {
  CREATOR_TYPES,
  DEFAULT_CREATOR_TYPE,
  PLATFORM_PUBLISHER,
  isCreatorType,
} from "./creator-type";

describe("CreatorType domain", () => {
  test("creator type defaults to creator", () => {
    expect(DEFAULT_CREATOR_TYPE).toBe("creator");
  });

  test("defines exactly the allowed creator types", () => {
    expect(CREATOR_TYPES).toEqual(["creator", "platform"]);
  });

  test("accepts the platform type", () => {
    expect(isCreatorType("platform")).toBe(true);
    expect(isCreatorType("creator")).toBe(true);
  });

  test("rejects an invalid creator type", () => {
    expect(isCreatorType("admin")).toBe(false);
    expect(isCreatorType("")).toBe(false);
    expect(isCreatorType(undefined)).toBe(false);
    expect(isCreatorType(null)).toBe(false);
    expect(isCreatorType(123)).toBe(false);
  });
});

describe("PLATFORM_PUBLISHER", () => {
  test("is the deterministic first-party Permudah publisher", () => {
    expect(PLATFORM_PUBLISHER).toEqual({
      id: "b2da1210-548d-5ff1-9245-ae91d73a357b",
      slug: "permudah",
      display_name: "Permudah Official",
      bio: "Official workflows by Permudah.",
      type: "platform",
    });
  });

  test("has a platform type that passes validation", () => {
    expect(isCreatorType(PLATFORM_PUBLISHER.type)).toBe(true);
  });

  test("id is a valid UUID v5", () => {
    expect(PLATFORM_PUBLISHER.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});