import { describe, expect, test } from "vitest";
import {
  base64UrlDecodeJson,
  base64UrlEncodeJson,
  createRandomToken,
  signValue,
  timingSafeStringEqual,
  verifySignedValue,
} from "@/lib/google/crypto";

const SECRET = "test-cookie-secret-that-is-long-enough-1234";

describe("createRandomToken", () => {
  test("produces url-safe values of the requested length", () => {
    expect(createRandomToken(32)).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(createRandomToken(16)).toMatch(/^[A-Za-z0-9\-_]{22}$/);
  });

  test("produces unique values", () => {
    const values = new Set(Array.from({ length: 50 }, () => createRandomToken(16)));
    expect(values.size).toBe(50);
  });
});

describe("timingSafeStringEqual", () => {
  test("compares equal and unequal strings", () => {
    expect(timingSafeStringEqual("abc", "abc")).toBe(true);
    expect(timingSafeStringEqual("abc", "abd")).toBe(false);
    expect(timingSafeStringEqual("abc", "abcd")).toBe(false);
    expect(timingSafeStringEqual("", "")).toBe(true);
    expect(timingSafeStringEqual("", "a")).toBe(false);
  });
});

describe("signed values", () => {
  test("round-trips a value", async () => {
    const token = await signValue(SECRET, "purpose-a", "payload-value");
    expect(await verifySignedValue(SECRET, "purpose-a", token)).toBe("payload-value");
  });

  test("rejects a tampered payload", async () => {
    const token = await signValue(SECRET, "purpose-a", "payload-value");
    const tampered = `tampered.${token.slice(token.indexOf(".") + 1)}`;
    expect(await verifySignedValue(SECRET, "purpose-a", tampered)).toBeNull();
  });

  test("rejects a value signed with a different secret", async () => {
    const token = await signValue(SECRET, "purpose-a", "payload-value");
    const otherToken = await signValue("another-secret-that-is-long-enough-12345", "purpose-a", "payload-value");
    expect(await verifySignedValue(SECRET, "purpose-a", otherToken)).toBeNull();
    expect(token).not.toBe(otherToken);
  });

  test("rejects cross-purpose replay", async () => {
    const token = await signValue(SECRET, "purpose-a", "payload-value");
    expect(await verifySignedValue(SECRET, "purpose-b", token)).toBeNull();
  });

  test("rejects malformed tokens", async () => {
    expect(await verifySignedValue(SECRET, "purpose-a", "")).toBeNull();
    expect(await verifySignedValue(SECRET, "purpose-a", "no-signature")).toBeNull();
    expect(await verifySignedValue(SECRET, "purpose-a", "value.")).toBeNull();
    expect(await verifySignedValue(SECRET, "purpose-a", "value.!!!not-base64!!!")).toBeNull();
  });

  test("never contains the signing secret", async () => {
    const token = await signValue(SECRET, "purpose-a", "payload-value");
    expect(token).not.toContain(SECRET);
  });
});

describe("json helpers", () => {
  test("round-trips json", () => {
    const value = { a: 1, b: "two", c: true };
    expect(base64UrlDecodeJson(base64UrlEncodeJson(value))).toEqual(value);
  });

  test("returns null for invalid base64url or invalid json", () => {
    expect(base64UrlDecodeJson("!!!")).toBeNull();
    expect(base64UrlDecodeJson(btoa("not json"))).toBeNull();
  });

  test("refuses to encode a value that is not JSON serializable", () => {
    expect(() => base64UrlEncodeJson(undefined)).toThrow(TypeError);
  });
});
