import { describe, expect, test } from "vitest";
import { isGoogleSpreadsheetUrl, isGoogleWebAppUrl } from "@/lib/google/urls";

describe("isGoogleWebAppUrl", () => {
  test("accepts the Apps Script web app host over https", () => {
    expect(isGoogleWebAppUrl("https://script.google.com/macros/s/abc/exec")).toBe(true);
  });

  test("rejects other hosts, other schemes, and non-urls", () => {
    expect(isGoogleWebAppUrl("https://evil.example.com/macros/s/abc/exec")).toBe(false);
    expect(isGoogleWebAppUrl("http://script.google.com/macros/s/abc/exec")).toBe(false);
    expect(isGoogleWebAppUrl("//script.google.com/macros/s/abc/exec")).toBe(false);
    expect(isGoogleWebAppUrl("javascript:alert(1)")).toBe(false);
    expect(isGoogleWebAppUrl("")).toBe(false);
    expect(isGoogleWebAppUrl("not a url")).toBe(false);
  });

  test("rejects a lookalike host", () => {
    expect(isGoogleWebAppUrl("https://script.google.com.evil.example/exec")).toBe(false);
  });
});

describe("isGoogleSpreadsheetUrl", () => {
  test("accepts the Google Sheets host over https", () => {
    expect(isGoogleSpreadsheetUrl("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(true);
  });

  test("rejects other hosts and schemes", () => {
    expect(isGoogleSpreadsheetUrl("https://drive.google.com/file/d/abc")).toBe(false);
    expect(isGoogleSpreadsheetUrl("http://docs.google.com/spreadsheets/d/abc/edit")).toBe(false);
    expect(isGoogleSpreadsheetUrl("")).toBe(false);
  });
});
