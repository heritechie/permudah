/**
 * Pure domain constants and helpers for creator types. This module has no
 * server/client imports so it can be safely used from client components,
 * server components, and tests alike.
 */

/** Publisher kind for a creator row. "platform" is first-party Permudah. */
export type CreatorType = "creator" | "platform";

export const CREATOR_TYPES: readonly CreatorType[] = ["creator", "platform"];

export const DEFAULT_CREATOR_TYPE: CreatorType = "creator";

export function isCreatorType(value: unknown): value is CreatorType {
  return typeof value === "string" && (CREATOR_TYPES as readonly string[]).includes(value);
}

/**
 * The official first-party Permudah publisher. Seeded by migration with a
 * deterministic UUID; it must never be created through the auth/onboarding
 * flow and has no auth.users row.
 */
export const PLATFORM_PUBLISHER = {
  id: "b2da1210-548d-5ff1-9245-ae91d73a357b",
  slug: "permudah",
  display_name: "Permudah Official",
  bio: "Official workflows by Permudah.",
  type: "platform",
} as const;