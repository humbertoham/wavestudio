import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

import UpdateWellhubPlanPage from "./page";
import {
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "@/lib/wellhub-config";

describe("WellHub plan update page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every supported plan with no initial selection", () => {
    const html = renderToStaticMarkup(createElement(UpdateWellhubPlanPage));

    for (const value of WELLHUB_PLANS) {
      expect(html).toContain(`value="${value}"`);
      expect(html).toContain(WELLHUB_PLAN_LABELS[value]);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(WELLHUB_PLANS.length);
    expect(html).not.toContain("checked");
  });

  it("renders disabled submission without session or plan fetches", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const html = renderToStaticMarkup(createElement(UpdateWellhubPlanPage));

    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
