import { Affiliation, TokenReason, WellhubPlan } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyAdminAffiliationAndWellhubSync } from "@/lib/corporate-credits";

type PackRow = {
  id: string;
  packId: string;
  classesLeft: number;
  expiresAt: Date;
  pausedUntil?: Date | null;
  createdAt: Date;
};

function buildTx(params: {
  user: {
    id: string;
    affiliation: Affiliation;
    wellhubPlan: WellhubPlan | null;
    affiliationConfirmedAt?: Date | null;
  };
  packs: PackRow[];
}) {
  const packs = params.packs.map((pack) => ({ ...pack }));
  let createdPackCount = 0;
  const tx = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ ...params.user }),
      update: vi.fn().mockImplementation(({ data, select }: any) => {
        params.user.affiliation = data.affiliation;
        params.user.wellhubPlan = data.wellhubPlan;
        params.user.affiliationConfirmedAt = data.affiliationConfirmedAt;
        return Promise.resolve({
          id: params.user.id,
          affiliation: params.user.affiliation,
          wellhubPlan: params.user.wellhubPlan,
          affiliationConfirmedAt: params.user.affiliationConfirmedAt,
        });
      }),
    },
    pack: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    packPurchase: {
      aggregate: vi.fn().mockImplementation(({ where }: any) => {
        const now = where.expiresAt.gt as Date;
        const sum = packs
          .filter(
            (pack) =>
              pack.expiresAt > now &&
              pack.classesLeft > 0 &&
              (!pack.pausedUntil || pack.pausedUntil <= now)
          )
          .reduce((total, pack) => total + pack.classesLeft, 0);

        return Promise.resolve({ _sum: { classesLeft: sum } });
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        const now = where.expiresAt.gt as Date;
        const ids = where.packId.in as string[];
        return Promise.resolve(
          packs
            .filter(
              (pack) =>
                ids.includes(pack.packId) &&
                pack.expiresAt > now &&
                pack.classesLeft > 0
            )
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime() ||
                b.id.localeCompare(a.id)
            )
            .map((pack) => ({
              id: pack.id,
              classesLeft: pack.classesLeft,
              createdAt: pack.createdAt,
            }))
        );
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        const pack = packs.find((row) => row.id === where.id);
        const decrement = data.classesLeft.decrement as number;
        if (!pack || pack.classesLeft < decrement) {
          return Promise.resolve({ count: 0 });
        }

        pack.classesLeft -= decrement;
        return Promise.resolve({ count: 1 });
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        createdPackCount += 1;
        const id = `created_${createdPackCount}`;
        packs.push({
          id,
          packId: data.packId,
          classesLeft: data.classesLeft,
          expiresAt: data.expiresAt,
          pausedUntil: null,
          createdAt: new Date("2026-07-13T12:00:00.000Z"),
        });
        return Promise.resolve({ id });
      }),
    },
    tokenLedger: {
      create: vi.fn().mockResolvedValue({ id: "ledger_1" }),
    },
  };

  return { tx: tx as any, packs };
}

describe("applyAdminAffiliationAndWellhubSync", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const cycleEnd = new Date("2026-08-01T00:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds only the Gold+ to Platinum entitlement difference and preserves purchased credits", async () => {
    const { tx, packs } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.GOLD_PLUS,
      },
      packs: [
        {
          id: "wellhub_gold",
          packId: "corp_wellhub_gold_plus_monthly",
          classesLeft: 2,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          id: "purchase_1",
          packId: "paid_pack",
          classesLeft: 5,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
        },
      ],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.WELLHUB,
      nextWellhubPlan: WellhubPlan.PLATINUM,
      adminActorId: "admin_1",
      now,
    });

    expect(result.creditDeltaApplied).toBe(6);
    expect(result.tokenBalance).toBe(13);
    expect(packs.find((pack) => pack.id === "purchase_1")?.classesLeft).toBe(5);
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        packId: "corp_wellhub_platinum_monthly",
        classesLeft: 6,
        expiresAt: cycleEnd,
      }),
      select: { id: true },
    });
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        delta: 6,
        reason: TokenReason.ADMIN_WELLHUB_PLAN_CHANGE,
        metadata: expect.objectContaining({
          previousWellhubPlan: WellhubPlan.GOLD_PLUS,
          newWellhubPlan: WellhubPlan.PLATINUM,
          previousMonthlyEntitlement: 2,
          newMonthlyEntitlement: 8,
          resultingAvailableBalance: 13,
          adminActorId: "admin_1",
        }),
      }),
      select: { id: true },
    });
  });

  it("removes only unused WellHub credits on Platinum to Gold+ and does not touch unrelated credits", async () => {
    const { tx, packs } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.PLATINUM,
      },
      packs: [
        {
          id: "wellhub_platinum",
          packId: "corp_wellhub_platinum_monthly",
          classesLeft: 5,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          id: "purchase_1",
          packId: "paid_pack",
          classesLeft: 4,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
        },
      ],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.WELLHUB,
      nextWellhubPlan: WellhubPlan.GOLD_PLUS,
      now,
    });

    expect(result.creditDeltaApplied).toBe(-5);
    expect(result.tokenBalance).toBe(4);
    expect(packs.find((pack) => pack.id === "wellhub_platinum")?.classesLeft).toBe(0);
    expect(packs.find((pack) => pack.id === "purchase_1")?.classesLeft).toBe(4);
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate credits or misleading ledger rows when the plan is unchanged", async () => {
    const { tx } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.PLATINUM,
      },
      packs: [
        {
          id: "wellhub_platinum",
          packId: "corp_wellhub_platinum_monthly",
          classesLeft: 8,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.WELLHUB,
      nextWellhubPlan: WellhubPlan.PLATINUM,
      now,
    });

    expect(result.creditDeltaApplied).toBe(0);
    expect(result.traceabilityCreated).toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.packPurchase.create).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });

  it("grants the current entitlement when changing from NONE to WellHub", async () => {
    const { tx } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.NONE,
        wellhubPlan: null,
      },
      packs: [],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.WELLHUB,
      nextWellhubPlan: WellhubPlan.PLATINUM,
      now,
    });

    expect(result.creditDeltaApplied).toBe(8);
    expect(result.tokenBalance).toBe(8);
    expect(result.user.wellhubPlan).toBe(WellhubPlan.PLATINUM);
    expect(tx.packPurchase.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        packId: "corp_wellhub_platinum_monthly",
        classesLeft: 8,
      }),
      select: { id: true },
    });
  });

  it("removes current-cycle unused WellHub credits when changing WellHub to NONE", async () => {
    const { tx, packs } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.GOLD_PLUS,
      },
      packs: [
        {
          id: "wellhub_gold",
          packId: "corp_wellhub_gold_plus_monthly",
          classesLeft: 1,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          id: "purchase_1",
          packId: "paid_pack",
          classesLeft: 7,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-02T00:00:00.000Z"),
        },
      ],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.NONE,
      nextWellhubPlan: null,
      now,
    });

    expect(result.creditDeltaApplied).toBe(-1);
    expect(result.tokenBalance).toBe(7);
    expect(packs.find((pack) => pack.id === "wellhub_gold")?.classesLeft).toBe(0);
    expect(packs.find((pack) => pack.id === "purchase_1")?.classesLeft).toBe(7);
  });

  it("records traceability when the plan changes but the entitlement amount is the same", async () => {
    const { tx } = buildTx({
      user: {
        id: "user_1",
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.DIAMOND,
      },
      packs: [
        {
          id: "wellhub_diamond",
          packId: "corp_wellhub_diamond_monthly",
          classesLeft: 30,
          expiresAt: cycleEnd,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });

    const result = await applyAdminAffiliationAndWellhubSync(tx, {
      userId: "user_1",
      nextAffiliation: Affiliation.WELLHUB,
      nextWellhubPlan: WellhubPlan.DIAMOND_PLUS,
      now,
    });

    expect(result.creditDeltaApplied).toBe(0);
    expect(result.traceabilityCreated).toBe(true);
    expect(tx.tokenLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        delta: 0,
        reason: TokenReason.ADMIN_WELLHUB_PLAN_CHANGE,
      }),
      select: { id: true },
    });
  });
});
