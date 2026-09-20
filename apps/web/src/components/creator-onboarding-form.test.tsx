// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CreatorOnboardingForm } from "@/components/creator-onboarding-form";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ available: true }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function getSlugField() {
  return document.getElementById("slug") as HTMLInputElement;
}

function getSlugFieldContainer() {
  return getSlugField().parentElement as HTMLElement;
}

describe("creator onboarding slug input", () => {
  test("typing masterdigital results in exactly masterdigital", () => {
    render(<CreatorOnboardingForm />);
    const input = getSlugField();

    fireEvent.change(input, { target: { value: "masterdigital" } });

    expect(input.value).toBe("masterdigital");
  });

  test("each keystroke produces exactly one corresponding update", () => {
    render(<CreatorOnboardingForm />);
    const input = getSlugField();

    const typed = "masterdigital";
    const events: string[] = [];
    for (let i = 1; i <= typed.length; i += 1) {
      const step = typed.slice(0, i);
      fireEvent.change(input, { target: { value: step } });
      events.push(input.value);
    }

    expect(events).toEqual([
      "m",
      "ma",
      "mas",
      "mast",
      "maste",
      "master",
      "masterd",
      "masterdi",
      "masterdig",
      "masterdigi",
      "masterdigit",
      "masterdigita",
      "masterdigital",
    ]);
  });

  test("value is not duplicated inside the slug field", () => {
    render(<CreatorOnboardingForm />);
    const input = getSlugField();

    fireEvent.change(input, { target: { value: "masterdigital" } });

    expect(input.value).toBe("masterdigital");
    // The slug must appear only as the input value — a text overlay that
    // renders the slug again (e.g. a leading prefix label) would make the
    // field look like "masterdigitalmasterdigital". The field must not
    // duplicate the slug in its rendered text.
    const container = getSlugFieldContainer();
    expect(container.textContent).not.toContain("masterdigital");
  });

  test("normalization lowercases and removes invalid characters", () => {
    render(<CreatorOnboardingForm />);
    const input = getSlugField();

    fireEvent.change(input, { target: { value: "  Master-Digital!" } });

    expect(input.value).toBe("master-digital");
  });

  test("availability check receives the same normalized slug", async () => {
    render(<CreatorOnboardingForm />);
    fireEvent.change(getSlugField(), { target: { value: "MasterDigital" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const requested = fetchMock.mock.calls.map(([url]) => String(url));
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/api/creator-slug?slug=masterdigital");

    await waitFor(() => {
      expect(screen.getByText(/Available — masterdigital\.permudah\.com/)).toBeDefined();
    });

    // The input must not reset after availability resolves.
    expect(getSlugField().value).toBe("masterdigital");
  });
});