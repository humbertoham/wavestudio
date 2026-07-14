import { describe, expect, it } from "vitest";

import {
  WELLHUB_CONFIRMATION_COPY,
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
});
