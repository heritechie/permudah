import { describe, expect, test } from "vitest";
import { readWebAppResult, signWebAppResult } from "@/lib/google/result";
import { readGoogleOAuthTransaction } from "@/lib/google/transaction";

const SECRET = "test-cookie-secret-that-is-long-enough-1234";
const TTL_MS = 10 * 60 * 1000;
const NOW = 1_757_000_000_000;

const INPUT = {
  appName: "Hello from Permudah",
  ownerEmail: "creator@example.com",
  spreadsheetId: "sheet-1",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
  scriptId: "script-1",
  webAppUrl: "https://script.google.com/macros/s/abc123/exec",
  userId: "permudah-user-1",
  now: NOW,
};

const EXPECTED = { ...INPUT, issuedAt: NOW, now: undefined };

describe("web app result reference", () => {
  test("round-trips the user-owned resource references", async () => {
    const token = await signWebAppResult(SECRET, INPUT);
    const result = await readWebAppResult(SECRET, token, { now: NOW, ttlMs: TTL_MS });

    expect(result).toEqual(EXPECTED);
  });

  test("rejects a tampered reference", async () => {
    const token = await signWebAppResult(SECRET, INPUT);
    const separator = token.indexOf(".");
    const tampered = `eyJ3ZWJBcHBVcmwiOiJodHRwczovL2V2aWwuY29tIn0.${token.slice(separator + 1)}`;
    expect(await readWebAppResult(SECRET, tampered, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects a reference signed with a different secret", async () => {
    const token = await signWebAppResult("another-secret-long-enough-value-12345", INPUT);
    expect(await readWebAppResult(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects an expired reference", async () => {
    const token = await signWebAppResult(SECRET, INPUT);
    expect(await readWebAppResult(SECRET, token, { now: NOW + TTL_MS + 1, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects a non-Google web app url", async () => {
    const token = await signWebAppResult(SECRET, {
      ...INPUT,
      webAppUrl: "https://evil.example.com/steal",
    });
    expect(await readWebAppResult(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects a non-Google spreadsheet url", async () => {
    const token = await signWebAppResult(SECRET, {
      ...INPUT,
      spreadsheetUrl: "https://evil.example.com/sheet",
    });
    expect(await readWebAppResult(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("rejects an http web app url", async () => {
    const token = await signWebAppResult(SECRET, {
      ...INPUT,
      webAppUrl: "http://script.google.com/macros/s/abc123/exec",
    });
    expect(await readWebAppResult(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("cannot be replayed as an oauth transaction", async () => {
    const token = await signWebAppResult(SECRET, INPUT);
    expect(await readGoogleOAuthTransaction(SECRET, token, { now: NOW, ttlMs: TTL_MS })).toBeNull();
  });

  test("contains no Google credential fields", async () => {
    const token = await signWebAppResult(SECRET, INPUT);
    expect(token).not.toContain("accessToken");
    expect(token).not.toContain("refreshToken");
    expect(token).not.toContain("ya29.");
  });
});
