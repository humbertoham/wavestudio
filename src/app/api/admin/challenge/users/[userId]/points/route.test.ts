import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireChallengeAdmin: vi.fn(),
  setUserChallengePoints: vi.fn(),
  challengeErrorResponse: vi.fn(),
}));

vi.mock("@/app/api/admin/challenge/_auth", () => ({
  requireChallengeAdmin: mocks.requireChallengeAdmin,
}));

vi.mock("@/lib/challenge", () => ({
  CHALLENGE_USER_MAX_POINTS: 1_000_000,
  setUserChallengePoints: mocks.setUserChallengePoints,
  challengeErrorResponse: mocks.challengeErrorResponse,
}));

import { PATCH } from "./route";

function request(body: unknown) {
  return new Request("https://example.test/api/admin/challenge/users/user_1/points", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

function context(userId = "user_1") {
  return { params: Promise.resolve({ userId }) };
}

describe("PATCH /api/admin/challenge/users/:userId/points", () => {
  beforeEach(() => {
    mocks.requireChallengeAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin_1", role: "ADMIN" },
    });
    mocks.setUserChallengePoints.mockResolvedValue({
      userId: "user_1",
      points: 25,
      updatedAt: new Date("2026-07-18T12:00:00.000Z"),
      activationVersion: 3,
      changed: true,
    });
    mocks.challengeErrorResponse.mockReturnValue(null);
  });

  it("allows an authenticated admin to set an integer, including zero", async () => {
    for (const points of [25, 0]) {
      mocks.setUserChallengePoints.mockResolvedValueOnce({
        userId: "user_1",
        points,
        updatedAt: new Date("2026-07-18T12:00:00.000Z"),
        activationVersion: 3,
        changed: true,
      });
      const response = await PATCH(
        request({ points, expectedPoints: 4, expectedUpdatedAt: null }),
        context()
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        item: { userId: "user_1", points },
      });
    }
  });

  it.each([
    {},
    { points: "", expectedPoints: 0, expectedUpdatedAt: null },
    { points: Number.NaN, expectedPoints: 0, expectedUpdatedAt: null },
    { points: 1.5, expectedPoints: 0, expectedUpdatedAt: null },
    { points: -1, expectedPoints: 0, expectedUpdatedAt: null },
    { points: 1_000_001, expectedPoints: 0, expectedUpdatedAt: null },
  ])("rejects invalid input %#", async (body) => {
    const response = await PATCH(request(body), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_USER_CHALLENGE_POINTS",
    });
    expect(mocks.setUserChallengePoints).not.toHaveBeenCalled();
  });

  it.each(["USER", "COACH"])("does not allow a %s", async (role) => {
    mocks.requireChallengeAdmin.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ code: "FORBIDDEN" }, { status: 403 }),
      role,
    });
    const response = await PATCH(
      request({ points: 2, expectedPoints: 1, expectedUpdatedAt: null }),
      context()
    );
    expect(response.status).toBe(403);
    expect(mocks.setUserChallengePoints).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent target user", async () => {
    const error = { code: "USER_NOT_FOUND" };
    mocks.setUserChallengePoints.mockRejectedValueOnce(error);
    mocks.challengeErrorResponse.mockReturnValueOnce({
      status: 404,
      body: { code: "USER_NOT_FOUND", message: "El usuario no existe." },
    });
    const response = await PATCH(
      request({ points: 2, expectedPoints: 1, expectedUpdatedAt: null }),
      context("missing_user")
    );
    expect(response.status).toBe(404);
  });

  it("returns the current value on a stale-write conflict", async () => {
    const error = { code: "CHALLENGE_POINTS_CONFLICT" };
    mocks.setUserChallengePoints.mockRejectedValueOnce(error);
    mocks.challengeErrorResponse.mockReturnValueOnce({
      status: 409,
      body: {
        code: "CHALLENGE_POINTS_CONFLICT",
        current: { points: 9, updatedAt: "2026-07-18T12:00:00.000Z" },
      },
    });
    const response = await PATCH(
      request({ points: 2, expectedPoints: 1, expectedUpdatedAt: null }),
      context()
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      current: { points: 9 },
    });
  });
});
