/**
 * Validate that a redirect target is a safe internal Permudah path.
 *
 * Rejects:
 * - absolute URLs (https://evil.com/...)
 * - protocol-relative URLs (//evil.com/...)
 * - javascript: / data: / blob: schemes
 * - backslash paths (\\evil.com\...)
 * - empty or non-path strings
 * - paths that don't start with "/"
 */
export function isSafeInternalRedirect(target: string): boolean {
  if (!target || typeof target !== "string") return false;
  const trimmed = target.trim();
  if (trimmed.length === 0) return false;

  // Reject backslashes used for protocol confusion.
  if (trimmed.includes("\\")) return false;

  // Reject any scheme-like prefix (e.g., javascript:, data:, https:, mailto:).
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;

  // Reject protocol-relative URLs.
  if (trimmed.startsWith("//")) return false;

  // Only allow relative paths starting with "/".
  if (!trimmed.startsWith("/")) return false;

  return true;
}
