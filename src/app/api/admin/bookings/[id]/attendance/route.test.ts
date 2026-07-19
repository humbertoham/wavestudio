import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireClassManager: vi.fn(),
  getUserFromSession: vi.fn(),
  updateAttendanceWithChallenge: vi.fn(),
  challengeErrorResponse: vi.fn(),
}));

vi.mock("../../../_utils", () => ({
  requireClassManager: mocks.requireClassManager,
  getUserFromSession: mocks.getUserFromSession,
}));
vi.mock("@/lib/challenge", () => ({
  updateAttendanceWithChallenge: mocks.updateAttendanceWithChallenge,
  challengeErrorResponse: mocks.challengeErrorResponse,
}));

import { PATCH } from "./route";

function req(body: unknown) {
  return new Request(
    "https://example.test/api/admin/bookings/booking_1/attendance",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  ) as any;
}

const ctx = { params: Promise.resolve({ id: "booking_1" }) };

describe("PATCH attendance Challenge integration", () => {
  it("lets an existing class manager run the atomic attendance mutation", async () => {
    mocks.requireClassManager.mockResolvedValue(null);
    mocks.getUserFromSession.mockResolvedValue({ id: "coach_1", role: "COACH" });
    mocks.updateAttendanceWithChallenge.mockResolvedValue({
      id: "booking_1",
      attended: true,
      changed: true,
      challenge: { delta: 3, points: 8 },
    });

    const response = await PATCH(req({ attended: true }), ctx);
    expect(mocks.updateAttendanceWithChallenge).toHaveBeenCalledWith({
      bookingId: "booking_1",
      attended: true,
      actorUserId: "coach_1",
    });
    await expect(response.json()).resolves.toMatchObject({
      attended: true,
      challenge: { delta: 3, points: 8 },
    });
  });

  it("preserves class-manager authorization failures", async () => {
    mocks.requireClassManager.mockResolvedValue(
      Response.json({ error: "FORBIDDEN" }, { status: 403 })
    );

    const response = await PATCH(req({ attended: true }), ctx);
    expect(response.status).toBe(403);
    expect(mocks.updateAttendanceWithChallenge).not.toHaveBeenCalled();
  });

  it("rejects malformed attendance without opening a transaction", async () => {
    mocks.requireClassManager.mockResolvedValue(null);
    mocks.getUserFromSession.mockResolvedValue({ id: "admin_1", role: "ADMIN" });

    const response = await PATCH(req({ attended: "yes" }), ctx);
    expect(response.status).toBe(400);
    expect(mocks.updateAttendanceWithChallenge).not.toHaveBeenCalled();
  });
});
