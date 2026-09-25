import { describe, expect, test } from "vitest";
import { createGoogleSpreadsheet, getGoogleDriveFileOwners, trashGoogleDriveFile } from "@/lib/google/drive";
import { authHeaderOf, fakeGoogleFetch, jsonBodyOf, TEST_CALL_CONTEXT } from "@/lib/google/test-utils";

describe("createGoogleSpreadsheet", () => {
  test("creates a spreadsheet with the spreadsheet MIME type", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files": {
        body: {
          id: "file-1",
          name: "Test App",
          mimeType: "application/vnd.google-apps.spreadsheet",
          webViewLink: "https://docs.google.com/spreadsheets/d/file-1/edit",
        },
      },
    });

    const file = await createGoogleSpreadsheet(fetchImpl, "token-ok", "Test App", TEST_CALL_CONTEXT);

    expect(file.id).toBe("file-1");
    expect(file.mimeType).toBe("application/vnd.google-apps.spreadsheet");

    const body = jsonBodyOf(calls, "www.googleapis.com/drive/v3/files");
    expect(body).toMatchObject({
      name: "Test App",
      mimeType: "application/vnd.google-apps.spreadsheet",
    });
    expect(authHeaderOf(calls, "www.googleapis.com/drive/v3/files")).toBe("Bearer token-ok");
  });

  test("requests a minimal fields projection", () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files": { body: { id: "file-1" } },
    });

    void createGoogleSpreadsheet(fetchImpl, "token-ok", "App", TEST_CALL_CONTEXT).then(() => {
      const call = calls.find((c) => c.url.includes("/drive/v3/files"))!;
      const url = new URL(call.url);
      expect(url.searchParams.get("fields")).toBe("id,name,mimeType,webViewLink");
    });
  });

  test("throws unauthorized on 401", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files": { status: 401, body: {} },
    });

    await expect(createGoogleSpreadsheet(fetchImpl, "token-bad", "App", TEST_CALL_CONTEXT)).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  test("does not leak the token in the error message", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files": { status: 403, body: {} },
    });

    try {
      await createGoogleSpreadsheet(fetchImpl, "super-secret-token", "App", TEST_CALL_CONTEXT);
      throw new Error("expected rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-token");
    }
  });
});

describe("getGoogleDriveFileOwners", () => {
  test("returns owning email addresses", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": {
        body: {
          owners: [
            { emailAddress: "User@Example.com" },
            { emailAddress: "other@example.com" },
          ],
        },
      },
    });

    const owners = await getGoogleDriveFileOwners(fetchImpl, "token-ok", "file-1", TEST_CALL_CONTEXT);
    expect(owners).toEqual(["user@example.com", "other@example.com"]);
  });

  test("requests the owners projection", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": {
        body: { owners: [{ emailAddress: "user@example.com" }] },
      },
    });

    await getGoogleDriveFileOwners(fetchImpl, "token-ok", "file-1", TEST_CALL_CONTEXT);
    const call = calls.find((c) => c.url.includes("/drive/v3/files/file-1"))!;
    const url = new URL(call.url);
    expect(url.searchParams.get("fields")).toBe("owners(emailAddress)");
  });

  test("throws unauthorized when owners cannot be read", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": { body: {} },
    });

    await expect(getGoogleDriveFileOwners(fetchImpl, "token-ok", "file-1", TEST_CALL_CONTEXT)).rejects.toMatchObject(
      { kind: "unauthorized" },
    );
  });
});

describe("trashGoogleDriveFile", () => {
  test("DELETEs the file with the user token", async () => {
    const { fetchImpl, calls } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": { status: 204, body: null },
    });

    const trashed = await trashGoogleDriveFile(fetchImpl, "token-ok", "file-1", TEST_CALL_CONTEXT);

    expect(trashed).toEqual({ ok: true });
    const call = calls.find((c) => c.url.includes("/drive/v3/files/file-1"))!;
    expect(call.init?.method).toBe("DELETE");
    expect(authHeaderOf(calls, "/drive/v3/files/file-1")).toBe("Bearer token-ok");
  });

  test("never throws and never leaks the token when cleanup fails", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": { status: 403, body: {} },
    });

    const result = await trashGoogleDriveFile(
      fetchImpl,
      "super-secret-token",
      "file-1",
      TEST_CALL_CONTEXT,
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-token");
  });

  test("reports a cleanup failure instead of masking it", async () => {
    const { fetchImpl } = fakeGoogleFetch({
      "www.googleapis.com/drive/v3/files/file-1": {
        status: 403,
        body: { error: { status: "PERMISSION_DENIED", message: "Insufficient permissions." } },
      },
    });

    const result = await trashGoogleDriveFile(fetchImpl, "token-ok", "file-1", TEST_CALL_CONTEXT);

    expect(result).toMatchObject({ ok: false, status: 403, code: "PERMISSION_DENIED" });
  });
});