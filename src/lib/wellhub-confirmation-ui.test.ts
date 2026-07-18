import { describe, expect, it, vi } from "vitest";

import {
  completeWellhubConfirmationNavigation,
  WELLHUB_CONFIRMATION_COPY,
  WELLHUB_CONFIRMATION_DESTINATION,
  validateWellhubConfirmationSelection,
} from "./wellhub-confirmation-ui";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "./wellhub-config";

describe("WellHub confirmation UI contract", () => {
  it("provides the required Spanish blocking copy", () => {
    expect(WELLHUB_CONFIRMATION_COPY).toMatchObject({
      title: "Actualiza tu plan de WellHub",
      note: "Selecciona tu plan actual para continuar.",
      submit: "Guardar y continuar",
    });
    expect(WELLHUB_CONFIRMATION_COPY.body).toContain(
      "confirmes cuál es tu plan actual de WellHub"
    );
  });

  it("derives every display option and credit value from the canonical config", () => {
    expect(WELLHUB_PLANS).toEqual([
      "GOLD_PLUS",
      "PLATINUM",
      "DIAMOND",
      "DIAMOND_PLUS",
    ]);
    for (const plan of WELLHUB_PLANS) {
      expect(WELLHUB_PLAN_LABELS[plan]).toBeTruthy();
      expect(WELLHUB_PLAN_CREDITS[plan]).toBeGreaterThan(0);
    }
  });

  it("shows a useful validation error before an empty submission", () => {
    expect(validateWellhubConfirmationSelection("")).toContain("Selecciona");
    expect(validateWellhubConfirmationSelection("PLATINUM")).toBeNull();
  });

  it("replaces history without an unnecessary second session request", async () => {
    const calls: string[] = [];

    await expect(
      completeWellhubConfirmationNavigation({
        replace: (destination) => calls.push(`replace:${destination}`),
        refreshRouter: () => calls.push("router-refresh"),
      })
    ).resolves.toBe(WELLHUB_CONFIRMATION_DESTINATION);

    expect(calls).toEqual(["replace:/clases", "router-refresh"]);
  });

  it("does not navigate when refreshed auth state is still pending", async () => {
    const replace = vi.fn();

    await expect(
      completeWellhubConfirmationNavigation({
        refreshSession: async () => ({
          wellhubPlanConfirmationRequired: true,
        }),
        replace,
        refreshRouter: vi.fn(),
      })
    ).rejects.toThrow("sesión");
    expect(replace).not.toHaveBeenCalled();
  });
});
