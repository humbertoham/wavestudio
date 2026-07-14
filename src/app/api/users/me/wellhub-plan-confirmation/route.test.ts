import { WellhubPlan } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  transaction: vi.fn(),
  confirm: vi.fn(),
  signToken: vi.fn(() => "new-token"),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/jwt", () => ({ signToken: mocks.signToken }));
vi.mock("@/lib/wellhub-plan-confirmation", async () => {
  class TestError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    WELLHUB_CONFIRMATION_MAX_RETRIES: 3,
    WellhubPlanConfirmationError: TestError,
    confirmWellhubPlanInTransaction: mocks.confirm,
  };
});

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/users/me/wellhub-plan-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const result = {
  campaign: "campaign-1",
  previousPlan: WellhubPlan.GOLD_PLUS,
  selectedPlan: WellhubPlan.PLATINUM,
  previousMonthlyEntitlement: 2,
  newMonthlyEntitlement: 8,
  creditDeltaApplied: 6,
  resultingBalance: 11,
  ledgerEntryId: "ledger_1",
  confirmedAt: new Date(),
  accessRestored: true,
};

describe("POST /api/users/me/wellhub-plan-confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      sub: "user_self",
      role: "USER",
      affiliationConfirmed: true,
      sessionVersion: 5,
    });
    mocks.confirm.mockResolvedValue(result);
    mocks.transaction.mockImplementation(async (callback: any) => callback({}));
  });

  it("rejects unauthenticated and unsupported/malformed plan submissions", async () => {
    mocks.requireAuth.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await POST(req({ wellhubPlan: "PLATINUM" }))).status).toBe(401);

    for (const plan of ["gold+", "PLATINUM ", "LEGACY", null, 8]) {
      const response = await POST(req({ wellhubPlan: plan }));
      expect(response.status, String(plan)).toBe(400);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts every canonical plan and always uses the authenticated user ID", async () => {
    for (const plan of Object.values(WellhubPlan)) {
      const response = await POST(
        req({ wellhubPlan: plan, userId: "another-user" })
      );
      expect(response.status, plan).toBe(200);
      expect(mocks.confirm).toHaveBeenLastCalledWith(
        {},
        expect.objectContaining({
          userId: "user_self",
          selectedPlan: plan,
        })
      );
    }
  });

  it("returns the synchronized delta/balance and refreshes the access cookie", async () => {
    const response = await POST(req({ wellhubPlan: "PLATINUM" }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      confirmation: {
        campaign: "campaign-1",
        creditDeltaApplied: 6,
        resultingBalance: 11,
        accessRestored: true,
      },
    });
    expect(response.headers.get("set-cookie")).toContain("session=new-token");
    expect(mocks.signToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "user_self",
        sessionVersion: 5,
        wellhubPlanConfirmationRequired: false,
      })
    );
  });
});
