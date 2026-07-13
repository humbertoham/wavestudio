import { describe, expect, it, vi } from "vitest";

import {
  ChallengeError,
  challengeErrorResponse,
  getClassChallengeSnapshot,
  parseChallengePoints,
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
});
