import {
  Affiliation,
  Prisma,
  TokenReason,
  WellhubPlan,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateSessionPayload } from "./auth";
import { prisma } from "./prisma";
import {
  WellhubPlanConfirmationError,
  confirmWellhubPlanInTransaction,
} from "./wellhub-plan-confirmation";
import { WELLHUB_PLAN_PACK_IDS, ensureCorporatePacks } from "./wellhub";
// @ts-ignore JavaScript command module intentionally exports testable functions.
import { runCampaignCommand } from "../../scripts/require-wellhub-plan-confirmation.mjs";

const runDatabaseTests =
  process.env.RUN_WELLHUB_CONFIRMATION_DB_TESTS === "1";
const dbDescribe = runDatabaseTests ? describe : describe.skip;
const fixtureUserIds: string[] = [];
const fixturePackIds: string[] = [];
const fixtureChallengeIds: string[] = [];

function unique(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function nextMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

async function createPendingUser(plan: WellhubPlan | null = WellhubPlan.GOLD_PLUS) {
  const id = unique("wellhub_confirmation_user");
  const campaign = unique("wellhub-campaign");
  const requestedAt = new Date();
  fixtureUserIds.push(id);
  await prisma.user.create({
    data: {
      id,
      name: "WellHub confirmation integration fixture",
      email: `${id}@example.invalid`,
      passwordHash: "not-a-real-login-hash",
      affiliation: Affiliation.WELLHUB,
      wellhubPlan: plan,
      affiliationConfirmedAt: requestedAt,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationRequestedAt: requestedAt,
      wellhubPlanConfirmationCampaign: campaign,
      authVersion: 1,
      wellhubPlanConfirmations: {
        create: {
          campaign,
          status: "PENDING",
          requestedAt,
          source: "INTEGRATION_TEST",
          idempotencyKey: `wellhub-plan-confirmation:${campaign}:${id}`,
        },
      },
    },
  });
  return { id, campaign };
}

async function serialConfirmation(userId: string, selectedPlan: WellhubPlan) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) =>
          confirmWellhubPlanInTransaction(tx, { userId, selectedPlan }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002") &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}

dbDescribe("WellHub confirmation real database integration", () => {
  beforeAll(async () => {
    await ensureCorporatePacks(prisma);
  });

  afterAll(async () => {
    if (fixtureUserIds.length > 0) {
      await prisma.challengeUserTotal.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.tokenLedger.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.booking.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.packPurchase.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.wellhubPlanConfirmation.deleteMany({
        where: { userId: { in: fixtureUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: fixtureUserIds } },
      });
    }
    if (fixturePackIds.length > 0) {
      await prisma.pack.deleteMany({ where: { id: { in: fixturePackIds } } });
    }
    if (fixtureChallengeIds.length > 0) {
      await prisma.challenge.deleteMany({
        where: { id: { in: fixtureChallengeIds } },
      });
    }
    await prisma.$disconnect();
  });

  it("upgrades atomically, preserves paid credits, and writes campaign traceability", async () => {
    const { id, campaign } = await createPendingUser();
    const paidPackId = unique("paid_pack");
    fixturePackIds.push(paidPackId);
    await prisma.pack.create({
      data: {
        id: paidPackId,
        name: "Integration paid pack",
        classes: 5,
        price: 500,
        validityDays: 30,
      },
    });
    await prisma.packPurchase.createMany({
      data: [
        {
          userId: id,
          packId: WELLHUB_PLAN_PACK_IDS.GOLD_PLUS,
          classesLeft: 2,
          expiresAt: nextMonth(),
        },
        {
          userId: id,
          packId: paidPackId,
          classesLeft: 5,
          expiresAt: nextMonth(),
        },
      ],
    });

    const result = await serialConfirmation(id, WellhubPlan.PLATINUM);
    expect(result).toMatchObject({
      campaign,
      creditDeltaApplied: 6,
      resultingBalance: 13,
      accessRestored: true,
    });

    const [user, paid, audit, ledger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id } }),
      prisma.packPurchase.findFirstOrThrow({
        where: { userId: id, packId: paidPackId },
      }),
      prisma.wellhubPlanConfirmation.findUniqueOrThrow({
        where: { campaign_userId: { campaign, userId: id } },
      }),
      prisma.tokenLedger.findUniqueOrThrow({
        where: {
          idempotencyKey: `wellhub-plan-confirmation:${campaign}:${id}`,
        },
      }),
    ]);
    expect(user).toMatchObject({
      wellhubPlan: WellhubPlan.PLATINUM,
      wellhubPlanConfirmationRequired: false,
    });
    expect(paid.classesLeft).toBe(5);
    expect(audit).toMatchObject({
      status: "COMPLETED",
      selectedPlan: WellhubPlan.PLATINUM,
      creditDeltaApplied: 6,
    });
    expect(ledger).toMatchObject({
      reason: TokenReason.USER_WELLHUB_PLAN_CONFIRMATION,
      delta: 6,
    });
  });

  it("allows exactly one concurrent confirmation and never duplicates adjustments", async () => {
    const { id, campaign } = await createPendingUser(WellhubPlan.PLATINUM);
    await prisma.packPurchase.create({
      data: {
        userId: id,
        packId: WELLHUB_PLAN_PACK_IDS.PLATINUM,
        classesLeft: 8,
        expiresAt: nextMonth(),
      },
    });
    const attempts = await Promise.allSettled([
      serialConfirmation(id, WellhubPlan.PLATINUM),
      serialConfirmation(id, WellhubPlan.PLATINUM),
    ]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find((item) => item.status === "rejected");
    expect(rejection).toBeTruthy();
    expect(
      rejection?.status === "rejected" &&
        rejection.reason instanceof WellhubPlanConfirmationError
    ).toBe(true);
    expect(
      await prisma.tokenLedger.count({
        where: {
          idempotencyKey: `wellhub-plan-confirmation:${campaign}:${id}`,
        },
      })
    ).toBe(1);
    expect(
      await prisma.packPurchase.aggregate({
        where: { userId: id },
        _sum: { classesLeft: true },
      })
    ).toEqual({ _sum: { classesLeft: 8 } });
  });

  it("rolls back plan, ledger, audit, and blocking state if any later transaction step fails", async () => {
    const { id, campaign } = await createPendingUser();
    await prisma.packPurchase.create({
      data: {
        userId: id,
        packId: WELLHUB_PLAN_PACK_IDS.GOLD_PLUS,
        classesLeft: 2,
        expiresAt: nextMonth(),
      },
    });

    await expect(
      prisma.$transaction(
        async (tx) => {
          await confirmWellhubPlanInTransaction(tx, {
            userId: id,
            selectedPlan: WellhubPlan.DIAMOND,
          });
          throw new Error("simulated downstream failure");
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    ).rejects.toThrow("simulated downstream failure");

    const [user, audit, ledgerCount] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id } }),
      prisma.wellhubPlanConfirmation.findUniqueOrThrow({
        where: { campaign_userId: { campaign, userId: id } },
      }),
      prisma.tokenLedger.count({
        where: {
          idempotencyKey: `wellhub-plan-confirmation:${campaign}:${id}`,
        },
      }),
    ]);
    expect(user).toMatchObject({
      wellhubPlan: WellhubPlan.GOLD_PLUS,
      wellhubPlanConfirmationRequired: true,
    });
    expect(audit.status).toBe("PENDING");
    expect(ledgerCount).toBe(0);
  });

  it("command application increments authVersion once and makes the old JWT version invalid", async () => {
    const id = unique("wellhub_command_user");
    fixtureUserIds.push(id);
    await prisma.user.create({
      data: {
        id,
        name: "WellHub command integration fixture",
        email: `${id}@example.invalid`,
        passwordHash: "not-a-real-login-hash",
        role: "COACH",
        bookingBlocked: true,
        affiliation: Affiliation.WELLHUB,
        wellhubPlan: WellhubPlan.PLATINUM,
        affiliationConfirmedAt: new Date(),
      },
    });
    const paidPackId = unique("wellhub_command_paid_pack");
    fixturePackIds.push(paidPackId);
    await prisma.pack.create({
      data: {
        id: paidPackId,
        name: "WellHub command safety fixture",
        classes: 7,
        price: 700,
        validityDays: 30,
      },
    });
    const purchase = await prisma.packPurchase.create({
      data: {
        userId: id,
        packId: paidPackId,
        classesLeft: 7,
        expiresAt: nextMonth(),
      },
    });
    const challenge = await prisma.challenge.create({
      data: {
        key: unique("wellhub_command_challenge"),
        name: "WellHub command safety challenge",
        isActive: false,
      },
    });
    fixtureChallengeIds.push(challenge.id);
    await prisma.challengeUserTotal.create({
      data: { challengeId: challenge.id, userId: id, points: 17 },
    });
    const unchangedBefore = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id },
        select: {
          role: true,
          bookingBlocked: true,
          affiliation: true,
          wellhubPlan: true,
        },
      }),
      prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } }),
      prisma.challengeUserTotal.findUniqueOrThrow({
        where: {
          challengeId_userId: { challengeId: challenge.id, userId: id },
        },
      }),
      prisma.tokenLedger.count({ where: { userId: id } }),
    ]);
    const campaign = unique("wellhub-command-campaign");
    const dryRun = await runCampaignCommand(prisma, {
      target: "dev",
      campaign,
      apply: false,
      userId: id,
    });
    expect(dryRun).toMatchObject({ wouldFlag: 1, newlyFlagged: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).authVersion).toBe(0);

    const applied = await runCampaignCommand(prisma, {
      target: "dev",
      campaign,
      apply: true,
      userId: id,
    });
    expect(applied).toMatchObject({
      newlyFlagged: 1,
      sessionsInvalidated: 1,
      afterRequiringConfirmation: 1,
      remainingToModify: 0,
    });
    await expect(
      validateSessionPayload({ sub: id, role: "USER", sessionVersion: 0 })
    ).resolves.toBeNull();

    const rerun = await runCampaignCommand(prisma, {
      target: "dev",
      campaign,
      apply: true,
      userId: id,
    });
    expect(rerun.newlyFlagged).toBe(0);
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(currentUser.authVersion).toBe(1);
    const unchangedAfter = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id },
        select: {
          role: true,
          bookingBlocked: true,
          affiliation: true,
          wellhubPlan: true,
        },
      }),
      prisma.packPurchase.findUniqueOrThrow({ where: { id: purchase.id } }),
      prisma.challengeUserTotal.findUniqueOrThrow({
        where: {
          challengeId_userId: { challengeId: challenge.id, userId: id },
        },
      }),
      prisma.tokenLedger.count({ where: { userId: id } }),
    ]);
    expect(unchangedAfter).toEqual(unchangedBefore);
  });
});
