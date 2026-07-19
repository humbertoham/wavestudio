import { describe, expect, it } from "vitest";

import {
  hasPendingWellhubPlanConfirmation,
  isWellhubConfirmationAllowedPath,
  shouldRequireWellhubPlanConfirmation,
} from "./wellhub-confirmation-gate";

const pendingWellhubState = {
  affiliation: "WELLHUB",
  wellhubPlanConfirmationRequired: true,
  wellhubPlanConfirmationCampaign: "campaign-1",
  pendingWellhubPlanConfirmationCampaigns: ["campaign-1"],
};

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
      expect(
        shouldRequireWellhubPlanConfirmation(path, pendingWellhubState)
      ).toBe(true);
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
      expect(
        shouldRequireWellhubPlanConfirmation(path, pendingWellhubState)
      ).toBe(false);
    }
  });

  it("does not affect unflagged sessions", () => {
    expect(shouldRequireWellhubPlanConfirmation("/clases", null)).toBe(false);
    expect(
      shouldRequireWellhubPlanConfirmation("/api/bookings", undefined)
    ).toBe(false);
  });

  it("requires the canonical WellHub affiliation, active flag, and matching pending campaign", () => {
    expect(hasPendingWellhubPlanConfirmation(pendingWellhubState)).toBe(true);
    expect(
      hasPendingWellhubPlanConfirmation({
        ...pendingWellhubState,
        affiliation: "TOTALPASS",
      })
    ).toBe(false);
    expect(
      hasPendingWellhubPlanConfirmation({
        ...pendingWellhubState,
        wellhubPlanConfirmationRequired: false,
      })
    ).toBe(false);
    expect(
      hasPendingWellhubPlanConfirmation({
        ...pendingWellhubState,
        pendingWellhubPlanConfirmationCampaigns: ["other-campaign"],
      })
    ).toBe(false);
  });
});
