import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    waitlist: {
      count: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { DELETE, GET } from "./route";

function req() {
  return new Request("https://example.test/api/classes/class_1") as any;
}

function ctx(id = "class_1") {
  return { params: Promise.resolve({ id }) };
}

function classPayload() {
  return {
    id: "class_1",
    title: "Strength",
    focus: "Full body",
    date: new Date("2026-06-23T23:00:00.000Z"),
    durationMin: 60,
    capacity: 12,
    isCanceled: false,
    deletedAt: null,
    instructor: { id: "instructor_1", name: "Coach" },
    bookings: [
      {
        id: "booking_first",
        userId: "user_1",
        quantity: 1,
        status: "ACTIVE",
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        user: {
          id: "user_1",
          name: "First User",
          email: "first@example.test",
          phone: null,
          affiliation: "NONE",
        },
      },
      {
        id: "booking_later",
        userId: "user_2",
        quantity: 1,
        status: "ACTIVE",
        createdAt: new Date("2026-06-02T10:00:00.000Z"),
        user: {
          id: "user_2",
          name: "Returning User",
          email: "returning@example.test",
          phone: null,
          affiliation: "NONE",
        },
      },
    ],
    waitlist: [],
  };
}

describe("GET /api/classes/[id]", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "coach_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "coach_1",
      role: "COACH",
      email: "coach@example.test",
      name: "Coach",
    });
    mocks.prisma.class.findUnique.mockResolvedValue(classPayload());
    mocks.prisma.booking.findMany.mockResolvedValue([{ userId: "user_2" }]);
    mocks.prisma.booking.count.mockResolvedValue(0);
    mocks.prisma.waitlist.count.mockResolvedValue(0);
    mocks.prisma.class.delete.mockResolvedValue({ id: "class_1" });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(mocks.prisma)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows coaches to load class detail", async () => {
    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
    expect(mocks.prisma.class.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "class_1" } })
    );
  });

  it("allows admins to load class detail", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "admin_1",
      role: "ADMIN",
      email: "admin@example.test",
      name: "Admin",
    });

    const res = await GET(req(), ctx());

    expect(res.status).toBe(200);
  });

  it("blocks regular users from class-management detail", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      role: "USER",
      email: "user@example.test",
      name: "User",
    });

    const res = await GET(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "FORBIDDEN",
    });
    expect(res.status).toBe(403);
    expect(mocks.prisma.class.findUnique).not.toHaveBeenCalled();
  });

  it("marks only a user's earliest qualifying booking for NEW USER display", async () => {
    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(body.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "booking_first",
          isNewUser: true,
          isFirstBooking: true,
        }),
        expect.objectContaining({
          id: "booking_later",
          isNewUser: false,
          isFirstBooking: false,
        }),
      ])
    );
    expect(mocks.prisma.booking.findMany).toHaveBeenCalledTimes(1);
  });

  it("uses one batched query that excludes cancelled bookings and cancelled classes", async () => {
    await GET(req(), ctx());

    expect(mocks.prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          class: { is: { isCanceled: false, deletedAt: null } },
          OR: expect.any(Array),
        }),
        distinct: ["userId"],
      })
    );
    expect(mocks.prisma.booking.findMany).toHaveBeenCalledTimes(1);
  });

  it("does not classify guest bookings as NEW USER", async () => {
    const payload = classPayload();
    payload.bookings.push({
      id: "guest_booking",
      userId: null as any,
      quantity: 1,
      status: "ACTIVE",
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
      user: null as any,
    });
    mocks.prisma.class.findUnique.mockResolvedValue(payload);

    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(body.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "guest_booking",
          isNewUser: false,
          isFirstBooking: false,
        }),
      ])
    );
  });

  it("returns not found for an archived class detail", async () => {
    mocks.prisma.class.findUnique.mockResolvedValue({
      ...classPayload(),
      deletedAt: new Date(),
    });

    const res = await GET(req(), ctx());

    expect(res.status).toBe(404);
    expect(mocks.prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it("lets a coach use the same transactional calendar deletion flow", async () => {
    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      hardDeleted: true,
      archived: false,
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" }
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/clases");
  });

  it("does not let a regular user delete through class management", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user_1",
      role: "USER",
      email: "user@example.test",
      name: "User",
    });

    const res = await DELETE(req(), ctx());

    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
