import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    class: {
      findUnique: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    waitlist: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { GET } from "./route";

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
    mocks.prisma.booking.findMany.mockResolvedValue([
      { id: "booking_first", userId: "user_1" },
      { id: "older_booking", userId: "user_2" },
      { id: "booking_later", userId: "user_2" },
    ]);
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

  it("marks only the user's first-ever booking for NEW USER display", async () => {
    const res = await GET(req(), ctx());
    const body = await res.json();

    expect(body.bookings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "booking_first",
          isFirstBooking: true,
        }),
        expect.objectContaining({
          id: "booking_later",
          isFirstBooking: false,
        }),
      ])
    );
  });
});
