import {
  Affiliation,
  WellhubPlan,
  WellhubPlanConfirmationStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { recoverSessionStateFromTransition } from "./wellhub-session-recovery";

const now = new Date("2026-07-18T12:00:00.000Z");
const payload = {
  sub: "user_1",
  role: "USER" as const,
  affiliationConfirmed: true,
  sessionVersion: 7,
  wellhubPlanConfirmationRequired: true,
  wellhubPlanConfirmationCampaign: "campaign-1",
};
const transition = {
  campaign: "campaign-1",
  userId: "user_1",
  status: WellhubPlanConfirmationStatus.COMPLETED,
  confirmedAt: new Date("2026-07-18T11:59:00.000Z"),
  selectedPlan: WellhubPlan.PLATINUM,
  authVersionBefore: 7,
  authVersionAfter: 8,
  sessionRecoveryExpiresAt: new Date("2026-07-18T12:14:00.000Z"),
  user: {
    id: "user_1",
    role: "COACH" as const,
    affiliation: Affiliation.WELLHUB,
    affiliationConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    authVersion: 8,
    wellhubPlanConfirmationRequired: false,
    wellhubPlanConfirmationCampaign: "campaign-1",
  },
};

describe("WellHub stale-session transition recovery", () => {
  it("recovers only the exact N to N+1 campaign transition and preserves role", () => {
    expect(
      recoverSessionStateFromTransition(transition, payload, now)
    ).toMatchObject({
      id: "user_1",
      role: "COACH",
      authVersion: 8,
      wellhubPlanConfirmationRequired: false,
    });
  });

  it.each([
    ["unrelated user", { ...payload, sub: "user_2" }, transition],
    [
      "unrelated campaign",
      { ...payload, wellhubPlanConfirmationCampaign: "campaign-2" },
      transition,
    ],
    ["wrong prior version", { ...payload, sessionVersion: 6 }, transition],
    [
      "non-consecutive transition",
      payload,
      { ...transition, authVersionAfter: 9 },
    ],
    [
      "later auth invalidation",
      payload,
      { ...transition, user: { ...transition.user, authVersion: 9 } },
    ],
    [
      "still-pending confirmation",
      payload,
      { ...transition, status: WellhubPlanConfirmationStatus.PENDING },
    ],
    [
      "non-WellHub user",
      payload,
      {
        ...transition,
        user: { ...transition.user, affiliation: Affiliation.TOTALPASS },
      },
    ],
  ])("rejects %s", (_label, candidatePayload, candidateTransition) => {
    expect(
      recoverSessionStateFromTransition(
        candidateTransition as typeof transition,
        candidatePayload,
        now
      )
    ).toBeNull();
  });

  it("rejects an otherwise valid transition after its bounded recovery window", () => {
    expect(
      recoverSessionStateFromTransition(
        transition,
        payload,
        transition.sessionRecoveryExpiresAt
      )
    ).toBeNull();
  });
});
