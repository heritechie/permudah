import { describe, expect, test } from "vitest";
import { decideDashboardGate } from "./dashboard";

const USER = { id: "11111111-1111-4111-8111-111111111111" };

const CREATOR = {
  id: USER.id,
  slug: "masterdigital",
  display_name: "Master Digital",
  bio: null,
  avatar_url: null,
};

describe("decideDashboardGate", () => {
  test("unauthenticated users are sent to login", () => {
    expect(decideDashboardGate(null, null)).toEqual({ kind: "login" });
  });

  test("authenticated users without a creator are sent to onboarding", () => {
    expect(decideDashboardGate(USER, null)).toEqual({ kind: "onboarding" });
  });

  test("authenticated creators pass the gate", () => {
    expect(decideDashboardGate(USER, CREATOR)).toEqual({
      kind: "authenticated",
      creator: CREATOR,
    });
  });
});