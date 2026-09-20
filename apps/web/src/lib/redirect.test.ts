import { describe, expect, test } from "vitest";
import { isSafeInternalRedirect } from "./redirect";

describe("isSafeInternalRedirect", () => {
  test("accepts internal paths", () => {
    expect(isSafeInternalRedirect("/oauth/consent?authorization_id=abc")).toBe(true);
    expect(isSafeInternalRedirect("/dashboard/workflows")).toBe(true);
    expect(isSafeInternalRedirect("/")).toBe(true);
  });

  test("rejects absolute external URLs", () => {
    expect(isSafeInternalRedirect("https://evil.com")).toBe(false);
    expect(isSafeInternalRedirect("https://permudah.com.evil.com/callback")).toBe(false);
  });

  test("rejects protocol-relative URLs", () => {
    expect(isSafeInternalRedirect("//evil.com")).toBe(false);
    expect(isSafeInternalRedirect("//permudah.com.evil.com")).toBe(false);
  });

  test("rejects javascript: and other schemes", () => {
    expect(isSafeInternalRedirect("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalRedirect("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeInternalRedirect("mailto:test@example.com")).toBe(false);
  });

  test("rejects backslash paths", () => {
    expect(isSafeInternalRedirect("\\evil.com")).toBe(false);
    expect(isSafeInternalRedirect("/\\evil.com")).toBe(false);
  });

  test("rejects empty or non-path strings", () => {
    expect(isSafeInternalRedirect("")).toBe(false);
    expect(isSafeInternalRedirect("   ")).toBe(false);
    expect(isSafeInternalRedirect("oauth/consent")).toBe(false);
  });
});
