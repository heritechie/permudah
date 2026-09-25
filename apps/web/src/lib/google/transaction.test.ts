import { describe, expect, test } from "vitest";
import { readGoogleOAuthTransaction, signGoogleOAuthTransaction } from "@/lib/google/transaction";

const SECRET = "test-cookie-secret-that-is-long-enough-1234";
const TTL_MS = 10 * 60 * 1000;
const NOW = 1_757_000_000_000;

const INPUT = {
  state: "state-value",
  codeVerifier: "verifier-value",
  userId: "permudah-user-1",
  now: NOW,
};

describe("google oauth transaction", () => {
  test("round-trips state, verifier, and Permudah user binding", async () => {
    const token = await signGoogleOAuthTransaction(SECRET, INPUT);
    const transaction = await readGoogleOAuthTransaction(SECRET, token, { now: NOW, ttlMs: TTL_MS });

    expect(transaction).toEqual({
      state: "state-value",
      codeVerifier: "verifier-value",
      userId: "permudah-user-1",
      issuedAt: NOW,
    });
  });

  test("does not expose the code verifier in plaintext", async () => {
    const token = await signGoogleOAuthTransaction(SECRET, INPUT);
    expect(token).not.toContain("verifier-value");
    expect(token).not.toContain(SECRET);
  });

  test("rejects a tampered transaction", async () => {
    const token = await signGoogleOAuthTransaction(SECRET, INPUT);
    const separator = token.indexOf(".");
    const tampered = `eyJzdGF0ZSI6ImF0dGFja2VyIn0.${token.slice(separator + 1)}`;
    expect(await readGoogleOAuthTransaction(SECRET, tampered, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects a transaction signed with a different secret", async () => {
    const token = await signGoogleOAuthTransaction("another-secret-long-enough-value-12345", INPUT);
    expect(await readGoogleOAuthTransaction(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects an expired transaction", async () => {
    const token = await signGoogleOAuthTransaction(SECRET, INPUT);
    expect(
      await readGoogleOAuthTransaction(SECRET, token, { now: NOW + TTL_MS + 1, ttlMs: TTL_MS }),
    ).toBeNull();
  });

  test("rejects a transaction issued far in the future", async () => {
    const token = await signGoogleOAuthTransaction(SECRET, INPUT);
    expect(
      await readGoogleOAuthTransaction(SECRET, token, { now: NOW - 10 * 60_000, ttlMs: TTL_MS }),
    ).toBeNull();
  });

  test("rejects garbage input", async () => {
    expect(await readGoogleOAuthTransaction(SECRET, "", { now: NOW, ttlMs: TTL_MS })).toBeNull();
    expect(await readGoogleOAuthTransaction(SECRET, "garbage", { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });
});
