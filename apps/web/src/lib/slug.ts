export const APP_ROOT_DOMAIN = "permudah.com";

export const RESERVED_CREATOR_SLUGS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "help",
  "support",
  "docs",
  "permudah",
]);

export const CREATOR_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function normalizeCreatorSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function sanitizeSlugInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: "required" | "invalid" | "reserved" };

export function validateCreatorSlug(slug: string): SlugValidation {
  const normalized = normalizeCreatorSlug(slug);
  if (!normalized) return { ok: false, reason: "required" };
  if (!CREATOR_SLUG_PATTERN.test(normalized)) {
    return { ok: false, reason: "invalid" };
  }
  if (RESERVED_CREATOR_SLUGS.has(normalized)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, slug: normalized };
}

export function creatorStorefrontUrl(slug: string, origin?: string): string {
  if (origin) {
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (host === "localhost" || host.endsWith(".localhost")) {
        const port = url.port ? `:${url.port}` : "";
        return `${url.protocol}//${slug}.localhost${port}`;
      }
    } catch {
      // fall through to the production domain
    }
  }
  return `https://${slug}.${APP_ROOT_DOMAIN}`;
}

export function workflowPublicUrl(
  creatorSlug: string,
  workflowSlug: string,
  origin?: string,
): string {
  return `${creatorStorefrontUrl(creatorSlug, origin)}/${workflowSlug}`;
}

export function resolvePostAuthDestination(
  creator: { slug: string } | null,
  origin?: string,
): string {
  if (creator) {
    return creatorStorefrontUrl(creator.slug, origin);
  }
  return `${origin ?? `https://${APP_ROOT_DOMAIN}`}/onboarding/creator`;
}