import { describe, expect, it } from "vitest";

import {
  isWellhubConfirmationAllowedPath,
  shouldRequireWellhubPlanConfirmation,
} from "./wellhub-confirmation-gate";

describe("forced WellHub plan confirmation gate", () => {
  it("blocks application pages and APIs for every flagged role", () => {
    for (const path of [
      "/",
      "/clases",
      "/perfil",
      "/mis-clases",
      "/admin",
      "/challenge",
      "/register",
      "/api/bookings",
      "/api/auth/register",
      "/api/admin/classes",
      "/api/challenge",
    ]) {
      expect(shouldRequireWellhubPlanConfirmation(path, true)).toBe(true);
    }
  });

  it("allows only the confirmation/authentication surface needed to finish or exit", () => {
    for (const path of [
      "/actualizar-plan-wellhub",
      "/api/wellhub/plans",
      "/api/users/me/wellhub-plan-confirmation",
      "/api/auth/me",
      "/api/auth/logout",
      "/login",
    ]) {
      expect(isWellhubConfirmationAllowedPath(path)).toBe(true);
      expect(shouldRequireWellhubPlanConfirmation(path, true)).toBe(false);
    }
  });

  it("does not affect unflagged sessions", () => {
    expect(shouldRequireWellhubPlanConfirmation("/clases", false)).toBe(false);
    expect(shouldRequireWellhubPlanConfirmation("/api/bookings", undefined)).toBe(false);
  });
});
