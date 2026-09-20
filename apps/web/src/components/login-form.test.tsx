import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { LoginForm } from "@/components/login-form";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithOtp: vi.fn(async () => ({ error: null })),
    },
  })),
}));

describe("LoginForm", () => {
  test("renders an email input and submit button", () => {
    const html = renderToString(<LoginForm />);
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain("Email me a login link");
  });

  test("renders with redirectTo prop without error", () => {
    const html = renderToString(<LoginForm redirectTo="/oauth/consent?authorization_id=abc" />);
    expect(html).toContain('type="email"');
    expect(html).toContain("Email me a login link");
  });
});