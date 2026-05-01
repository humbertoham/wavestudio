import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  createBookingWithCreditCheck: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/class-booking", () => ({
  createBookingWithCreditCheck: mocks.createBookingWithCreditCheck,
  isManagedBookingError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string",
}));

import { POST } from "./route";

function req(userId = "user_1") {
  return new Request("https://example.test/api/admin/classes/class_1/add-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  }) as any;
}

function ctx() {
  return { params: Promise.resolve({ id: "class_1" }) };
}

describe("POST /api/admin/classes/[id]/add-user", () => {
  beforeEach(() => {
    mocks.getAuthFromRequest.mockResolvedValue({ sub: "admin_1" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "admin_1",
      role: "ADMIN",
      email: "admin@example.test",
      name: "Admin",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses the shared credit-check helper and removes stale waitlist entries after booking", async () => {
    const tx = {
      waitlist: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mocks.createBookingWithCreditCheck.mockResolvedValue({ id: "booking_1" });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(req(), ctx());

    await expect(res.json()).resolves.toEqual({
      ok: true,
      bookingId: "booking_1",
    });
    expect(res.status).toBe(200);
    expect(mocks.createBookingWithCreditCheck).toHaveBeenCalledWith(tx, {
      classId: "class_1",
      userId: "user_1",
      quantity: 1,
      allowPastStart: true,
    });
    expect(tx.waitlist.deleteMany).toHaveBeenCalledWith({
      where: {
        classId: "class_1",
        userId: "user_1",
      },
    });
  });

  it("does not create admin user bookings without credits", async () => {
    mocks.createBookingWithCreditCheck.mockRejectedValue({
      code: "NO_CREDITS_AVAILABLE",
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({ waitlist: { deleteMany: vi.fn() } })
    );

    const res = await POST(req(), ctx());

    await expect(res.json()).resolves.toMatchObject({
      error: "NO_CREDITS_AVAILABLE",
    });
    expect(res.status).toBe(409);
  });
});
