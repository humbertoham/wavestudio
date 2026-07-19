import { describe, expect, it, vi } from "vitest";

import {
  ChallengeError,
  activateChallenge,
  challengeErrorResponse,
  deactivateChallenge,
  getClassChallengeSnapshot,
  parseChallengePoints,
  parseUserChallengePoints,
} from "./challenge";

describe("Challenge domain validation", () => {
  it.each([1, 3, 10])("accepts integer class point value %s", (value) => {
    expect(parseChallengePoints(value)).toBe(value);
  });

  it.each([0, 11, 1.5, "3", null, undefined, {}, Number.NaN])(
    "rejects malformed class point value %s",
    (value) => {
      expect(() => parseChallengePoints(value)).toThrowError(
        expect.objectContaining({ code: "INVALID_CHALLENGE_POINTS", status: 400 })
      );
    }
  );

  it.each([0, 25, 1_000_000])(
    "accepts integer user point value %s",
    (value) => {
      expect(parseUserChallengePoints(value)).toBe(value);
    }
  );

  it.each([-1, 1_000_001, 1.5, "3", null, undefined, Number.NaN])(
    "rejects malformed user point value %s",
    (value) => {
      expect(() => parseUserChallengePoints(value)).toThrowError(
        expect.objectContaining({
          code: "INVALID_USER_CHALLENGE_POINTS",
          status: 400,
        })
      );
    }
  );

  it("leaves classes created while inactive permanently ineligible", async () => {
    const tx = {
      challenge: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    await expect(getClassChallengeSnapshot(tx as any)).resolves.toEqual({
      challengeId: null,
      challengePoints: null,
      challengeEligibleAt: null,
      challengeActivationVersion: null,
    });
  });

  it("snapshots active class eligibility with the default of one point", async () => {
    const tx = {
      challenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "challenge_1",
          isActive: true,
          activationVersion: 4,
        }),
      },
    };

    const result = await getClassChallengeSnapshot(tx as any);
    expect(result).toMatchObject({
      challengeId: "challenge_1",
      challengePoints: 1,
      challengeActivationVersion: 4,
    });
    expect(result.challengeEligibleAt).toBeInstanceOf(Date);
  });

  it("returns stable error codes and Spanish messages", () => {
    const error = new ChallengeError(
      "CLASS_CHALLENGE_POINTS_LOCKED",
      "Los puntos están bloqueados.",
      409
    );
    expect(challengeErrorResponse(error)).toEqual({
      status: 409,
      body: {
        error: "CLASS_CHALLENGE_POINTS_LOCKED",
        code: "CLASS_CHALLENGE_POINTS_LOCKED",
        message: "Los puntos están bloqueados.",
      },
    });
  });

  it.each([
    ["activate", false],
    ["deactivate", true],
  ] as const)(
    "%s resets totals and current awards inside the lifecycle transaction",
    async (operation, initiallyActive) => {
      const challenge = {
        id: "challenge_1",
        key: "WAVE_CHALLENGE",
        name: "WAVE Challenge",
        isActive: operation === "activate",
        activationVersion: 2,
        activatedAt: new Date(),
        deactivatedAt: null,
      };
      const tx = {
        $executeRaw: vi.fn(),
        challenge: {
          findUnique: vi.fn().mockResolvedValue({
            ...challenge,
            isActive: initiallyActive,
          }),
          update: vi.fn().mockResolvedValue(challenge),
          create: vi.fn(),
        },
        challengeUserTotal: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
        challengeBookingAward: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      };
      const client = {
        $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
          callback(tx)
        ),
      };

      if (operation === "activate") {
        await activateChallenge("admin_1", client as any);
      } else {
        await deactivateChallenge("admin_1", client as any);
      }

      expect(client.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.challengeUserTotal.updateMany).toHaveBeenCalledWith({
        where: { challengeId: "challenge_1" },
        data: { points: 0 },
      });
      expect(tx.challengeBookingAward.updateMany).toHaveBeenCalledWith({
        where: { challengeId: "challenge_1", isAwarded: true },
        data: { isAwarded: false, reversedAt: expect.any(Date) },
      });
    }
  );

  it("fails the lifecycle request when the reset cannot complete", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      challenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "challenge_1",
          isActive: false,
        }),
        update: vi.fn().mockResolvedValue({
          id: "challenge_1",
          isActive: true,
        }),
      },
      challengeUserTotal: {
        updateMany: vi.fn().mockRejectedValue(new Error("reset failed")),
      },
      challengeBookingAward: { updateMany: vi.fn() },
    };
    const client = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx)
      ),
    };

    await expect(activateChallenge("admin_1", client as any)).rejects.toThrow(
      "reset failed"
    );
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.challengeBookingAward.updateMany).not.toHaveBeenCalled();
  });
});
