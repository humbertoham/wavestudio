import {
  Affiliation,
  TokenReason,
  WellhubPlan,
  WellhubPlanConfirmationStatus,
  type Prisma,
} from "@prisma/client";

import {
  USER_WELLHUB_PLAN_CONFIRMATION_SOURCE,
  applyAdminAffiliationAndWellhubSync,
} from "@/lib/corporate-credits";

export const WELLHUB_CONFIRMATION_MAX_RETRIES = 3;

export class WellhubPlanConfirmationError extends Error {
  constructor(
    public code:
      | "USER_NOT_FOUND"
      | "NOT_WELLHUB"
      | "CONFIRMATION_NOT_REQUIRED"
      | "CAMPAIGN_STATE_INVALID"
      | "ALREADY_CONFIRMED"
  ) {
    super(code);
  }
}

export function buildWellhubConfirmationIdempotencyKey(
  campaign: string,
  userId: string
) {
  return `wellhub-plan-confirmation:${campaign}:${userId}`;
}

export async function confirmWellhubPlanInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    selectedPlan: WellhubPlan;
    now?: Date;
  }
) {
  const now = params.now ?? new Date();
  const user = await tx.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      affiliation: true,
      wellhubPlan: true,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationRequestedAt: true,
      wellhubPlanConfirmationCampaign: true,
    },
  });

  if (!user) {
    throw new WellhubPlanConfirmationError("USER_NOT_FOUND");
  }

  if (user.affiliation !== Affiliation.WELLHUB) {
    throw new WellhubPlanConfirmationError("NOT_WELLHUB");
  }

  if (!user.wellhubPlanConfirmationRequired) {
    throw new WellhubPlanConfirmationError("CONFIRMATION_NOT_REQUIRED");
  }

  const campaign = user.wellhubPlanConfirmationCampaign;
  const requestedAt = user.wellhubPlanConfirmationRequestedAt;
  if (!campaign || !requestedAt) {
    throw new WellhubPlanConfirmationError("CAMPAIGN_STATE_INVALID");
  }

  const campaignRecord = await tx.wellhubPlanConfirmation.findUnique({
    where: { campaign_userId: { campaign, userId: user.id } },
    select: { id: true, status: true, requestedAt: true },
  });

  if (!campaignRecord) {
    throw new WellhubPlanConfirmationError("CAMPAIGN_STATE_INVALID");
  }
  if (campaignRecord.status === WellhubPlanConfirmationStatus.COMPLETED) {
    throw new WellhubPlanConfirmationError("ALREADY_CONFIRMED");
  }

  const idempotencyKey = buildWellhubConfirmationIdempotencyKey(
    campaign,
    user.id
  );
  const sync = await applyAdminAffiliationAndWellhubSync(tx, {
    userId: user.id,
    nextAffiliation: Affiliation.WELLHUB,
    nextWellhubPlan: params.selectedPlan,
    now,
    traceability: {
      source: USER_WELLHUB_PLAN_CONFIRMATION_SOURCE,
      reason: TokenReason.USER_WELLHUB_PLAN_CONFIRMATION,
      actorUserId: user.id,
      campaign,
      requestedAt: campaignRecord.requestedAt,
      idempotencyKey,
      alwaysCreate: true,
    },
  });

  const completed = await tx.wellhubPlanConfirmation.updateMany({
    where: {
      id: campaignRecord.id,
      status: WellhubPlanConfirmationStatus.PENDING,
    },
    data: {
      status: WellhubPlanConfirmationStatus.COMPLETED,
      confirmedAt: now,
      previousPlan: sync.previousWellhubPlan,
      selectedPlan: params.selectedPlan,
      previousMonthlyEntitlement: sync.previousMonthlyEntitlement,
      newMonthlyEntitlement: sync.newMonthlyEntitlement,
      creditDeltaApplied: sync.creditDeltaApplied,
      resultingBalance: sync.tokenBalance,
      ledgerEntryId: sync.ledgerEntryId,
    },
  });

  if (completed.count !== 1) {
    throw new WellhubPlanConfirmationError("ALREADY_CONFIRMED");
  }

  const unblocked = await tx.user.updateMany({
    where: {
      id: user.id,
      affiliation: Affiliation.WELLHUB,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: campaign,
    },
    data: {
      wellhubPlanConfirmationRequired: false,
      wellhubPlanConfirmedAt: now,
    },
  });

  if (unblocked.count !== 1) {
    throw new WellhubPlanConfirmationError("CAMPAIGN_STATE_INVALID");
  }

  return {
    campaign,
    previousPlan: sync.previousWellhubPlan,
    selectedPlan: params.selectedPlan,
    previousMonthlyEntitlement: sync.previousMonthlyEntitlement,
    newMonthlyEntitlement: sync.newMonthlyEntitlement,
    creditDeltaApplied: sync.creditDeltaApplied,
    resultingBalance: sync.tokenBalance,
    ledgerEntryId: sync.ledgerEntryId,
    confirmedAt: now,
    accessRestored: true,
  };
}
