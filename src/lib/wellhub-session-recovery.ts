import {
  Affiliation,
  WellhubPlanConfirmationStatus,
  type Role,
  type WellhubPlan,
} from "@prisma/client";

import type { JWTPayload } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import type { SessionUserState } from "@/lib/session-cookie";

type RecoverableTransition = {
  campaign: string;
  userId: string;
  status: WellhubPlanConfirmationStatus;
  confirmedAt: Date | null;
  selectedPlan: WellhubPlan | null;
  authVersionBefore: number | null;
  authVersionAfter: number | null;
  sessionRecoveryExpiresAt: Date | null;
  user: {
    id: string;
    role: Role;
    affiliation: Affiliation;
    affiliationConfirmedAt: Date | null;
    authVersion: number;
    wellhubPlanConfirmationRequired: boolean;
    wellhubPlanConfirmationCampaign: string | null;
  };
};

function asSessionUser(user: RecoverableTransition["user"]): SessionUserState {
  return {
    id: user.id,
    role: user.role,
    affiliationConfirmedAt: user.affiliationConfirmedAt,
    authVersion: user.authVersion,
    wellhubPlanConfirmationRequired:
      user.wellhubPlanConfirmationRequired,
    wellhubPlanConfirmationCampaign:
      user.wellhubPlanConfirmationCampaign,
  };
}

/**
 * Accepts only the signed cookie immediately preceding this exact completed
 * campaign transition. It is intentionally not a general stale-JWT escape.
 */
export function recoverSessionStateFromTransition(
  transition: RecoverableTransition | null,
  stalePayload: JWTPayload,
  now = new Date()
): SessionUserState | null {
  if (!transition) return null;
  const signedVersion = stalePayload.sessionVersion;
  const campaign = stalePayload.wellhubPlanConfirmationCampaign;
  if (
    stalePayload.sub !== transition.userId ||
    stalePayload.wellhubPlanConfirmationRequired !== true ||
    typeof campaign !== "string" ||
    campaign !== transition.campaign ||
    !Number.isInteger(signedVersion) ||
    transition.status !== WellhubPlanConfirmationStatus.COMPLETED ||
    transition.confirmedAt == null ||
    transition.selectedPlan == null ||
    transition.authVersionBefore !== signedVersion ||
    transition.authVersionAfter !== transition.authVersionBefore + 1 ||
    transition.user.authVersion !== transition.authVersionAfter ||
    transition.user.affiliation !== Affiliation.WELLHUB ||
    transition.user.wellhubPlanConfirmationRequired ||
    transition.user.wellhubPlanConfirmationCampaign !== campaign ||
    transition.sessionRecoveryExpiresAt == null ||
    transition.sessionRecoveryExpiresAt.getTime() <= now.getTime()
  ) {
    return null;
  }

  return asSessionUser(transition.user);
}

export async function getRecoverableWellhubSessionState(
  stalePayload: JWTPayload,
  now = new Date()
) {
  const campaign = stalePayload.wellhubPlanConfirmationCampaign;
  if (typeof campaign !== "string" || !stalePayload.sub) return null;

  const transition = await prisma.wellhubPlanConfirmation.findUnique({
    where: {
      campaign_userId: { campaign, userId: stalePayload.sub },
    },
    select: {
      campaign: true,
      userId: true,
      status: true,
      confirmedAt: true,
      selectedPlan: true,
      authVersionBefore: true,
      authVersionAfter: true,
      sessionRecoveryExpiresAt: true,
      user: {
        select: {
          id: true,
          role: true,
          affiliation: true,
          affiliationConfirmedAt: true,
          authVersion: true,
          wellhubPlanConfirmationRequired: true,
          wellhubPlanConfirmationCampaign: true,
        },
      },
    },
  });

  return recoverSessionStateFromTransition(transition, stalePayload, now);
}

/** Re-reads canonical state for a current session after an idempotent retry. */
export async function getCompletedWellhubSessionState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      affiliation: true,
      affiliationConfirmedAt: true,
      authVersion: true,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: true,
    },
  });
  if (
    !user ||
    user.affiliation !== Affiliation.WELLHUB ||
    user.wellhubPlanConfirmationRequired ||
    !user.wellhubPlanConfirmationCampaign
  ) {
    return null;
  }

  const completed = await prisma.wellhubPlanConfirmation.findUnique({
    where: {
      campaign_userId: {
        campaign: user.wellhubPlanConfirmationCampaign,
        userId: user.id,
      },
    },
    select: { status: true, confirmedAt: true, selectedPlan: true },
  });
  if (
    completed?.status !== WellhubPlanConfirmationStatus.COMPLETED ||
    !completed.confirmedAt ||
    !completed.selectedPlan
  ) {
    return null;
  }

  return asSessionUser(user);
}
