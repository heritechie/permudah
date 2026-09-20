import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LoginForm } from "@/components/login-form";

describe("LoginForm", () => {
  test("renders an email input and submit button", () => {
    const html = renderToString(<LoginForm />);
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain("Email me a login link");
  });
});