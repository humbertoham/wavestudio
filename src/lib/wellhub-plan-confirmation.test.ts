import {
  Affiliation,
  TokenReason,
  WellhubPlan,
  WellhubPlanConfirmationStatus,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  WellhubPlanConfirmationError,
  confirmWellhubPlanInTransaction,
} from "./wellhub-plan-confirmation";

function transaction(params?: {
  plan?: WellhubPlan | null;
  required?: boolean;
  affiliation?: Affiliation;
}) {
  const user = {
    id: "user_1",
    role: "COACH" as const,
    affiliation: params?.affiliation ?? Affiliation.WELLHUB,
    wellhubPlan:
      params && "plan" in params ? params.plan ?? null : WellhubPlan.PLATINUM,
    affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    authVersion: 4,
    wellhubPlanConfirmationRequired: params?.required ?? true,
    wellhubPlanConfirmationRequestedAt: new Date("2026-07-01T00:00:00.000Z"),
    wellhubPlanConfirmationCampaign: "campaign-1",
  };
  const pack = {
    id: "wellhub_pack",
    classesLeft: user.wellhubPlan === WellhubPlan.PLATINUM ? 8 : 0,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
  };

  const tx = {
    user: {
      findUnique: vi.fn(async () => ({ ...user })),
      update: vi.fn(async ({ data }: any) => {
        user.wellhubPlan = data.wellhubPlan;
        user.affiliationConfirmedAt = data.affiliationConfirmedAt;
        return { ...user };
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        user.wellhubPlanConfirmationRequired = false;
        if (data.authVersion?.increment) {
          user.authVersion += data.authVersion.increment;
        }
        return { count: 1 };
      }),
    },
    wellhubPlanConfirmation: {
      findUnique: vi.fn(async () => ({
        id: "confirmation_1",
        status: WellhubPlanConfirmationStatus.PENDING,
        requestedAt: user.wellhubPlanConfirmationRequestedAt,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    pack: { upsert: vi.fn(async () => ({})) },
    packPurchase: {
      aggregate: vi.fn(async () => ({ _sum: { classesLeft: pack.classesLeft } })),
      findMany: vi.fn(async () =>
        pack.classesLeft > 0 ? [{ ...pack }] : []
      ),
      create: vi.fn(async ({ data }: any) => {
        pack.classesLeft += data.classesLeft;
        return { id: "new_pack" };
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        pack.classesLeft -= data.classesLeft.decrement;
        return { count: 1 };
      }),
    },
    tokenLedger: {
      create: vi.fn(async () => ({ id: "ledger_1" })),
    },
  };
  return { tx: tx as any, user, pack };
}

describe("confirmWellhubPlanInTransaction", () => {
  it("confirms the same plan with zero delta, one audit ledger, and restored access", async () => {
    const { tx, user } = transaction();
    const result = await confirmWellhubPlanInTransaction(tx, {
      userId: "user_1",
      selectedPlan: WellhubPlan.PLATINUM,
      now: new Date("2026-07-13T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      campaign: "campaign-1",
      creditDeltaApplied: 0,
      resultingBalance: 8,
      accessRestored: true,
      authVersionBefore: 4,
      authVersionAfter: 5,
      sessionUser: {
        role: "COACH",
        authVersion: 5,
        wellhubPlanConfirmationRequired: false,
      },
    });
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        delta: 0,
        reason: TokenReason.USER_WELLHUB_PLAN_CONFIRMATION,
        idempotencyKey: "wellhub-plan-confirmation:campaign-1:user_1",
        metadata: expect.objectContaining({
          source: "USER_WELLHUB_PLAN_CONFIRMATION",
          campaign: "campaign-1",
          actorUserId: "user_1",
        }),
      }),
      select: { id: true },
    });
    expect(user.wellhubPlanConfirmationRequired).toBe(false);
    expect(user.authVersion).toBe(5);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ authVersion: 4 }),
      data: expect.objectContaining({ authVersion: { increment: 1 } }),
    });
    expect(tx.wellhubPlanConfirmation.updateMany).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: expect.objectContaining({
        authVersionBefore: 4,
        authVersionAfter: 5,
        sessionRecoveryExpiresAt: expect.any(Date),
      }),
    });
  });

  it("upgrades by only the canonical entitlement difference", async () => {
    const { tx } = transaction({ plan: WellhubPlan.GOLD_PLUS });
    tx.packPurchase.aggregate.mockResolvedValueOnce({ _sum: { classesLeft: 0 } });
    const result = await confirmWellhubPlanInTransaction(tx, {
      userId: "user_1",
      selectedPlan: WellhubPlan.PLATINUM,
    });
    expect(result.creditDeltaApplied).toBe(6);
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ classesLeft: 6 }),
      select: { id: true },
    });
  });

  it("handles a null legacy plan without duplicating identifiable unused WellHub credits", async () => {
    const { tx, pack } = transaction({ plan: null });
    pack.classesLeft = 5;
    const result = await confirmWellhubPlanInTransaction(tx, {
      userId: "user_1",
      selectedPlan: WellhubPlan.PLATINUM,
    });
    expect(result.creditDeltaApplied).toBe(3);
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ classesLeft: 3 }),
      select: { id: true },
    });
  });

  it("refuses an unflagged or non-WellHub user", async () => {
    const unflagged = transaction({ required: false });
    await expect(
      confirmWellhubPlanInTransaction(unflagged.tx, {
        userId: "user_1",
        selectedPlan: WellhubPlan.PLATINUM,
      })
    ).rejects.toEqual(
      new WellhubPlanConfirmationError("CONFIRMATION_NOT_REQUIRED")
    );

    const totalpass = transaction({ affiliation: Affiliation.TOTALPASS });
    await expect(
      confirmWellhubPlanInTransaction(totalpass.tx, {
        userId: "user_1",
        selectedPlan: WellhubPlan.PLATINUM,
      })
    ).rejects.toEqual(new WellhubPlanConfirmationError("NOT_WELLHUB"));
  });
});
