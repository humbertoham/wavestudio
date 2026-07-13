import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
    booking: { count: vi.fn() },
    class: { update: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { PATCH } from "./route";

function req() {
  return new Request(
    "https://example.test/api/admin/classes/class_1/cancel",
    { method: "PATCH" }
  ) as any;
}

function ctx() {
  return { params: Promise.resolve({ id: "class_1" }) };
}

describe("PATCH /api/admin/classes/[id]/cancel regression", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "coach_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "coach_1",
      role: "COACH",
      email: "coach@example.test",
      name: "Coach",
    });
    mocks.prisma.booking.count.mockResolvedValue(0);
    mocks.prisma.class.update.mockResolvedValue({
      id: "class_1",
      isCanceled: true,
      bookings: [],
      instructor: { id: "instructor_1" },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("still lets a coach cancel a class with no active bookings", async () => {
    const res = await PATCH(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.booking.count).toHaveBeenCalledWith({
      where: { classId: "class_1", status: "ACTIVE" },
    });
    expect(mocks.prisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "class_1" },
        data: { isCanceled: true },
      })
    );
  });

  it("still blocks class cancellation when active bookings exist", async () => {
    mocks.prisma.booking.count.mockResolvedValue(1);

    const res = await PATCH(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "CLASS_HAS_BOOKINGS",
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.class.update).not.toHaveBeenCalled();
  });
});
