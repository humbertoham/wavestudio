import {
  Affiliation,
  Prisma,
  TokenReason,
  WellhubPlan,
} from "@prisma/client";

import {
  WELLHUB_INTERNAL_PACK_IDS,
  WELLHUB_PLAN_PACK_IDS,
  ensureCorporatePacks,
  getWellhubPlanCredits,
} from "@/lib/wellhub";

export const ADMIN_WELLHUB_PLAN_CHANGE_SOURCE =
  "ADMIN_WELLHUB_PLAN_CHANGE";
export const USER_WELLHUB_PLAN_CONFIRMATION_SOURCE =
  "USER_WELLHUB_PLAN_CONFIRMATION";

export type WellhubSyncTraceability = {
  source: string;
  reason: TokenReason;
  actorUserId?: string | null;
  campaign?: string;
  requestedAt?: Date;
  idempotencyKey?: string;
  alwaysCreate?: boolean;
};

export type RenewalCycle = {
  id: string;
  start: Date;
  end: Date;
};

type UserAffiliationState = {
  affiliation: Affiliation;
  wellhubPlan: WellhubPlan | null;
};

type WellhubPackBalance = {
  id: string;
  classesLeft: number;
  createdAt: Date;
};

export type AdminAffiliationSyncResult = {
  user: {
    id: string;
    affiliation: Affiliation;
    wellhubPlan: WellhubPlan | null;
    affiliationConfirmedAt: Date | null;
  };
  previousBalance: number;
  tokenBalance: number;
  previousAffiliation: Affiliation;
  newAffiliation: Affiliation;
  previousWellhubPlan: WellhubPlan | null;
  newWellhubPlan: WellhubPlan | null;
  previousMonthlyEntitlement: number;
  newMonthlyEntitlement: number;
  creditDeltaApplied: number;
  traceabilityCreated: boolean;
  ledgerEntryId: string | null;
  cycleId: string;
};

export class CorporateCreditError extends Error {
  constructor(public code: "USER_NOT_FOUND" | "INSUFFICIENT_WELLHUB_CREDITS") {
    super(code);
  }
}

export function getUtcMonthCycle(now = new Date()): RenewalCycle {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const id = `${year}-${String(month + 1).padStart(2, "0")}`;

  return { id, start, end };
}

export function buildCorporateRenewalIdempotencyKey(
  cycleId: string,
  userId: string
) {
  return `corporate-renewal:${cycleId}:${userId}`;
}

export function getWellhubMonthlyEntitlement(
  affiliation: Affiliation | null | undefined,
  wellhubPlan: WellhubPlan | null | undefined
) {
  if (affiliation !== Affiliation.WELLHUB) return 0;
  return getWellhubPlanCredits(wellhubPlan) ?? 0;
}

export function isWellhubRelevantChange(
  previous: UserAffiliationState,
  next: UserAffiliationState
) {
  return (
    previous.affiliation === Affiliation.WELLHUB ||
    next.affiliation === Affiliation.WELLHUB ||
    previous.wellhubPlan !== next.wellhubPlan
  );
}

export async function getAvailableTokenBalance(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date()
) {
  const balance = await tx.packPurchase.aggregate({
    where: {
      userId,
      expiresAt: { gt: now },
      classesLeft: { gt: 0 },
      OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }],
    },
    _sum: { classesLeft: true },
  });

  return balance._sum.classesLeft ?? 0;
}

async function findUnusedWellhubPacks(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date
) {
  return tx.packPurchase.findMany({
    where: {
      userId,
      packId: { in: WELLHUB_INTERNAL_PACK_IDS },
      expiresAt: { gt: now },
      classesLeft: { gt: 0 },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      classesLeft: true,
      createdAt: true,
    },
  });
}

async function decrementWellhubPacks(
  tx: Prisma.TransactionClient,
  packs: WellhubPackBalance[],
  amount: number
) {
  let remaining = amount;

  for (const pack of packs) {
    if (remaining <= 0) break;

    const use = Math.min(pack.classesLeft, remaining);
    const updated = await tx.packPurchase.updateMany({
      where: {
        id: pack.id,
        classesLeft: { gte: use },
      },
      data: {
        classesLeft: { decrement: use },
      },
    });

    if (updated.count !== 1) {
      throw new CorporateCreditError("INSUFFICIENT_WELLHUB_CREDITS");
    }

    remaining -= use;
  }

  if (remaining > 0) {
    throw new CorporateCreditError("INSUFFICIENT_WELLHUB_CREDITS");
  }
}

function wellhubChangeMetadata(params: {
  previousAffiliation: Affiliation;
  newAffiliation: Affiliation;
  previousWellhubPlan: WellhubPlan | null;
  newWellhubPlan: WellhubPlan | null;
  previousMonthlyEntitlement: number;
  newMonthlyEntitlement: number;
  creditDeltaApplied: number;
  previousBalance: number;
  resultingAvailableBalance: number;
  adminActorId: string | null;
  traceability?: WellhubSyncTraceability;
  cycle: RenewalCycle;
  timestamp: Date;
}) {
  const source =
    params.traceability?.source ?? ADMIN_WELLHUB_PLAN_CHANGE_SOURCE;
  const actorUserId =
    params.traceability?.actorUserId ?? params.adminActorId;

  return {
    source,
    previousAffiliation: params.previousAffiliation,
    newAffiliation: params.newAffiliation,
    previousWellhubPlan: params.previousWellhubPlan ?? "NONE",
    newWellhubPlan: params.newWellhubPlan ?? "NONE",
    previousMonthlyEntitlement: params.previousMonthlyEntitlement,
    newMonthlyEntitlement: params.newMonthlyEntitlement,
    creditDeltaApplied: params.creditDeltaApplied,
    previousBalance: params.previousBalance,
    resultingAvailableBalance: params.resultingAvailableBalance,
    adminActorId: params.adminActorId ?? "UNKNOWN",
    actorUserId: actorUserId ?? "UNKNOWN",
    ...(params.traceability?.campaign
      ? { campaign: params.traceability.campaign }
      : {}),
    ...(params.traceability?.requestedAt
      ? {
          requestedAt:
            params.traceability.requestedAt.toISOString(),
        }
      : {}),
    cycleId: params.cycle.id,
    effectivePeriodStart: params.cycle.start.toISOString(),
    effectivePeriodEnd: params.cycle.end.toISOString(),
    timestamp: params.timestamp.toISOString(),
  } satisfies Prisma.InputJsonObject;
}

export async function applyAdminAffiliationAndWellhubSync(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    nextAffiliation: Affiliation;
    nextWellhubPlan: WellhubPlan | null;
    adminActorId?: string | null;
    traceability?: WellhubSyncTraceability;
    now?: Date;
  }
): Promise<AdminAffiliationSyncResult> {
  const now = params.now ?? new Date();
  const cycle = getUtcMonthCycle(now);

  const previousUser = await tx.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      affiliation: true,
      wellhubPlan: true,
      affiliationConfirmedAt: true,
    },
  });

  if (!previousUser) {
    throw new CorporateCreditError("USER_NOT_FOUND");
  }

  const nextState: UserAffiliationState = {
    affiliation: params.nextAffiliation,
    wellhubPlan: params.nextWellhubPlan,
  };
  const previousState: UserAffiliationState = {
    affiliation: previousUser.affiliation,
    wellhubPlan: previousUser.wellhubPlan,
  };

  const previousBalance = await getAvailableTokenBalance(tx, params.userId, now);
  const previousMonthlyEntitlement = getWellhubMonthlyEntitlement(
    previousState.affiliation,
    previousState.wellhubPlan
  );
  const newMonthlyEntitlement = getWellhubMonthlyEntitlement(
    nextState.affiliation,
    nextState.wellhubPlan
  );

  const unchanged =
    previousState.affiliation === nextState.affiliation &&
    previousState.wellhubPlan === nextState.wellhubPlan;

  if (unchanged && !params.traceability?.alwaysCreate) {
    return {
      user: previousUser,
      previousBalance,
      tokenBalance: previousBalance,
      previousAffiliation: previousState.affiliation,
      newAffiliation: nextState.affiliation,
      previousWellhubPlan: previousState.wellhubPlan,
      newWellhubPlan: nextState.wellhubPlan,
      previousMonthlyEntitlement,
      newMonthlyEntitlement,
      creditDeltaApplied: 0,
      traceabilityCreated: false,
      ledgerEntryId: null,
      cycleId: cycle.id,
    };
  }

  const updatedUser = unchanged
    ? previousUser
    : await tx.user.update({
        where: { id: params.userId },
        data: {
          affiliation: nextState.affiliation,
          wellhubPlan: nextState.wellhubPlan,
          affiliationConfirmedAt: now,
        },
        select: {
          id: true,
          affiliation: true,
          wellhubPlan: true,
          affiliationConfirmedAt: true,
        },
      });

  const wellhubRelevant =
    isWellhubRelevantChange(previousState, nextState) ||
    params.traceability?.alwaysCreate === true;
  let creditDeltaApplied = 0;
  let adjustmentPackPurchaseId: string | null = null;

  if (wellhubRelevant) {
    const unusedWellhubPacks = await findUnusedWellhubPacks(
      tx,
      params.userId,
      now
    );
    const currentUnusedWellhubCredits = unusedWellhubPacks.reduce(
      (sum, pack) => sum + pack.classesLeft,
      0
    );
    const consumedWellhubCredits = Math.max(
      0,
      previousMonthlyEntitlement - currentUnusedWellhubCredits
    );
    const targetUnusedWellhubCredits = Math.max(
      0,
      newMonthlyEntitlement - consumedWellhubCredits
    );

    creditDeltaApplied =
      targetUnusedWellhubCredits - currentUnusedWellhubCredits;

    if (creditDeltaApplied > 0 && nextState.wellhubPlan) {
      await ensureCorporatePacks(tx);

      const purchase = await tx.packPurchase.create({
        data: {
          userId: params.userId,
          packId: WELLHUB_PLAN_PACK_IDS[nextState.wellhubPlan],
          classesLeft: creditDeltaApplied,
          expiresAt: cycle.end,
        },
        select: { id: true },
      });

      adjustmentPackPurchaseId = purchase.id;
    } else if (creditDeltaApplied < 0) {
      await decrementWellhubPacks(
        tx,
        unusedWellhubPacks,
        Math.abs(creditDeltaApplied)
      );
    }
  }

  const tokenBalance = await getAvailableTokenBalance(tx, params.userId, now);
  let ledgerEntryId: string | null = null;

  if (wellhubRelevant) {
    const ledger = await tx.tokenLedger.create({
      data: {
        userId: params.userId,
        packPurchaseId: adjustmentPackPurchaseId,
        delta: creditDeltaApplied,
        reason:
          params.traceability?.reason ??
          TokenReason.ADMIN_WELLHUB_PLAN_CHANGE,
        idempotencyKey: params.traceability?.idempotencyKey,
        metadata: wellhubChangeMetadata({
          previousAffiliation: previousState.affiliation,
          newAffiliation: nextState.affiliation,
          previousWellhubPlan: previousState.wellhubPlan,
          newWellhubPlan: nextState.wellhubPlan,
          previousMonthlyEntitlement,
          newMonthlyEntitlement,
          creditDeltaApplied,
          previousBalance,
          resultingAvailableBalance: tokenBalance,
          adminActorId: params.adminActorId ?? null,
          traceability: params.traceability,
          cycle,
          timestamp: now,
        }),
      },
      select: { id: true },
    });

    ledgerEntryId = ledger.id;
  }

  return {
    user: updatedUser,
    previousBalance,
    tokenBalance,
    previousAffiliation: previousState.affiliation,
    newAffiliation: nextState.affiliation,
    previousWellhubPlan: previousState.wellhubPlan,
    newWellhubPlan: nextState.wellhubPlan,
    previousMonthlyEntitlement,
    newMonthlyEntitlement,
    creditDeltaApplied,
    traceabilityCreated: wellhubRelevant,
    ledgerEntryId,
    cycleId: cycle.id,
  };
}
