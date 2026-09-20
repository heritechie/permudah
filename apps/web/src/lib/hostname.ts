import { APP_ROOT_DOMAIN, CREATOR_SLUG_PATTERN, RESERVED_CREATOR_SLUGS } from "./slug";

export type HostInfo =
  | { kind: "root" }
  | { kind: "creator"; slug: string; displayName: string };

export function displayNameForSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function classifyHostname(hostname: string): HostInfo {
  if (
    hostname === APP_ROOT_DOMAIN ||
    hostname === `www.${APP_ROOT_DOMAIN}`
  ) {
    return { kind: "root" };
  }

  if (hostname.endsWith(`.${APP_ROOT_DOMAIN}`)) {
    const slug = hostname.slice(0, -(APP_ROOT_DOMAIN.length + 1));
    if (CREATOR_SLUG_PATTERN.test(slug) && !RESERVED_CREATOR_SLUGS.has(slug)) {
      return { kind: "creator", slug, displayName: displayNameForSlug(slug) };
    }
    return { kind: "root" };
  }

  if (hostname.endsWith(".localhost")) {
    const slug = hostname.slice(0, -".localhost".length);
    if (CREATOR_SLUG_PATTERN.test(slug)) {
      return { kind: "creator", slug, displayName: displayNameForSlug(slug) };
    }
  }

  return { kind: "root" };
}

export function parseHostname(host: string | null | undefined): HostInfo {
  if (!host) return { kind: "root" };
  let value = host.trim().toLowerCase();

  const ipv6 = value.match(/^\[([^\]]+)\]/);
  if (ipv6) {
    value = ipv6[1];
  } else {
    value = value.split(":")[0];
  }

  value = value.replace(/\.$/, "");

  if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
    return { kind: "root" };
  }

  return classifyHostname(value);
}

export function hostnameFromHeaders(headers: {
  get(name: string): string | null;
}): HostInfo {
  const forwarded = headers.get("x-forwarded-host");
  const host = headers.get("host");
  return parseHostname(forwarded ?? host);
}