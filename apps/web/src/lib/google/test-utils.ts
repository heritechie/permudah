import type { FetchLike } from "@/lib/google/http";
import type { GoogleCallContext } from "@/lib/google/logging";

/** Deterministic request context for tests. */
export const TEST_CALL_CONTEXT: GoogleCallContext = { correlationId: "test-correlation-id" };

/**
 * Set or remove an environment variable in tests. `process.env.NODE_ENV` is
 * typed read-only by Next, so writes go through a mutable view.
 */
export function setProcessEnv(key: string, value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

export function snapshotProcessEnv(keys: readonly string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

export function restoreProcessEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) setProcessEnv(key, value);
}

export type JsonResponseConfig = {
  body?: unknown;
  status?: number;
};

/**
 * Build a fake fetch for Google API tests. Routes match on URL substring and
 * return scripted JSON responses. Call log lets tests assert the requests that
 * were made (method, url, auth header, body) without calling real APIs.
 */
export function fakeGoogleFetch(routes: Record<string, JsonResponseConfig>): {
  fetchImpl: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    // Longest-needle-first so specific paths (e.g. .../deployments) win over
    // generic prefixes (e.g. .../projects) regardless of object key order.
    const entries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
    const entry = entries.find(([needle]) => url.includes(needle));
    const config: JsonResponseConfig = entry?.[1] ?? { body: null, status: 404 };
    const status = config.status ?? 200;

    // 204 responses must not carry a body.
    const serialized = status === 204 ? null : typeof config.body === "string" ? config.body : JSON.stringify(config.body ?? null);

    return new Response(serialized, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { fetchImpl, calls };
}

/**
 * Find the body of a JSON request for a given URL substring.
 */
export function jsonBodyOf(calls: Array<{ url: string; init?: RequestInit }>, needle: string): Record<string, unknown> | null {
  const call = calls.find((call) => call.url.includes(needle));
  if (!call || typeof call.init?.body !== "string") return null;
  try {
    return JSON.parse(call.init.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extract the Authorization header sent for the first call matching `needle`.
 */
export function authHeaderOf(calls: Array<{ url: string; init?: RequestInit }>, needle: string): string | null {
  const call = calls.find((call) => call.url.includes(needle));
  const headers = call?.init?.headers;
  if (headers && typeof headers === "object" && "Authorization" in headers) {
    return String((headers as { Authorization: unknown }).Authorization);
  }
  return null;
}