import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("./prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("./jwt", () => ({
  verifyToken: vi.fn(),
}));

import { validateSessionPayload } from "./auth";

describe("database-backed JWT auth version", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invalidates a JWT whose signed version is stale", async () => {
    mocks.findUnique.mockResolvedValue({
      role: "USER",
      affiliationConfirmedAt: new Date(),
      authVersion: 4,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-1",
    });
    await expect(
      validateSessionPayload({ sub: "user_1", role: "USER", sessionVersion: 3 })
    ).resolves.toBeNull();
  });

  it("accepts legacy version-zero JWTs for unaffected users", async () => {
    mocks.findUnique.mockResolvedValue({
      role: "USER",
      affiliationConfirmedAt: new Date(),
      authVersion: 0,
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmationCampaign: null,
    });
    await expect(
      validateSessionPayload({ sub: "user_1", role: "USER" })
    ).resolves.toMatchObject({
      sessionVersion: 0,
      wellhubPlanConfirmationRequired: false,
    });
  });

  it("uses the persisted required flag as source of truth", async () => {
    mocks.findUnique.mockResolvedValue({
      role: "COACH",
      affiliationConfirmedAt: new Date(),
      authVersion: 2,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-2",
    });
    await expect(
      validateSessionPayload({
        sub: "coach_1",
        role: "COACH",
        sessionVersion: 2,
        wellhubPlanConfirmationRequired: false,
      })
    ).resolves.toMatchObject({
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-2",
    });
  });
});
