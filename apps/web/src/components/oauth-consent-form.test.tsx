// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { OAuthConsentForm } from "@/components/oauth-consent-form";

vi.mock("@/app/oauth/consent/actions", () => ({
  approveAuthorizationAction: vi.fn(),
  denyAuthorizationAction: vi.fn(),
}));

const { approveAuthorizationAction, denyAuthorizationAction } = await import("@/app/oauth/consent/actions");

describe("OAuthConsentForm", () => {
  let assignedUrl: string | null = null;

  beforeEach(() => {
    assignedUrl = null;
    Object.defineProperty(window, "location", {
      writable: true,
      value: {
        ...window.location,
        assign: (url: string) => {
          assignedUrl = url;
        },
      },
    });
  });

  test("renders Allow and Deny buttons", () => {
    render(<OAuthConsentForm authorizationId="authz-1" />);
    expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
  });

  test("approve redirects to returned redirect_url", async () => {
    vi.mocked(approveAuthorizationAction).mockResolvedValue({
      ok: true,
      redirect_url: "https://client.example.com/callback?code=abc",
    });

    render(<OAuthConsentForm authorizationId="authz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(approveAuthorizationAction).toHaveBeenCalledWith("authz-1");
    });

    expect(assignedUrl).toBe("https://client.example.com/callback?code=abc");
  });

  test("deny redirects to returned redirect_url", async () => {
    vi.mocked(denyAuthorizationAction).mockResolvedValue({
      ok: true,
      redirect_url: "https://client.example.com/callback?error=access_denied",
    });

    render(<OAuthConsentForm authorizationId="authz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(denyAuthorizationAction).toHaveBeenCalledWith("authz-1");
    });

    expect(assignedUrl).toBe("https://client.example.com/callback?error=access_denied");
  });

  test("shows error when approve fails", async () => {
    vi.mocked(approveAuthorizationAction).mockResolvedValue({
      ok: false,
      error: "Authorization expired",
    });

    render(<OAuthConsentForm authorizationId="authz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });

    expect(screen.getByRole("alert").textContent).toBe("Authorization expired");
  });
});
