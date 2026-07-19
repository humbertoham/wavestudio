import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getAuth: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import ObsoleteAffiliationPage from "./page";

describe("obsolete /afiliacion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an unauthenticated visitor to login without a stale next value", async () => {
    mocks.getAuth.mockResolvedValue(null);

    await expect(ObsoleteAffiliationPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("sends a canonical pending WellHub user to plan confirmation", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "fixture-user", role: "USER" });
    mocks.findUnique.mockResolvedValue({
      affiliation: "WELLHUB",
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: "campaign-1",
      wellhubPlanConfirmations: [{ campaign: "campaign-1" }],
    });

    await expect(ObsoleteAffiliationPage()).rejects.toThrow(
      "REDIRECT:/actualizar-plan-wellhub"
    );
  });

  it("sends every other authenticated user to classes without modifying state", async () => {
    mocks.getAuth.mockResolvedValue({ sub: "fixture-user", role: "COACH" });
    mocks.findUnique.mockResolvedValue({
      affiliation: null,
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmationCampaign: null,
      wellhubPlanConfirmations: [],
    });

    await expect(ObsoleteAffiliationPage()).rejects.toThrow(
      "REDIRECT:/clases"
    );
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });
});
