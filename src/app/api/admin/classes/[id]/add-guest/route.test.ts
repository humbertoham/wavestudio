import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: mocks.getAuthFromRequest,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "./route";

function req(name = "Guest Person") {
  return new Request("https://example.test/api/admin/classes/class_1/add-guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }) as any;
}

function ctx() {
  return { params: Promise.resolve({ id: "class_1" }) };
}

describe("POST /api/admin/classes/[id]/add-guest", () => {
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

  it("still creates guest bookings without requiring user credits", async () => {
    const tx = {
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: "class_1",
          isCanceled: false,
          capacity: 3,
          bookings: [{ quantity: 1 }],
        }),
      },
      booking: {
        create: vi.fn().mockResolvedValue({
          id: "guest_booking_1",
          guestName: "Guest Person",
        }),
      },
      packPurchase: {
        updateMany: vi.fn(),
      },
      tokenLedger: {
        create: vi.fn(),
      },
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(req(), ctx());

    await expect(res.json()).resolves.toEqual({
      ok: true,
      bookingId: "guest_booking_1",
      guestName: "Guest Person",
    });
    expect(res.status).toBe(200);
    expect(tx.booking.create).toHaveBeenCalledWith({
      data: {
        classId: "class_1",
        guestName: "Guest Person",
        quantity: 1,
        status: "ACTIVE",
      },
      select: {
        id: true,
        guestName: true,
      },
    });
    expect(tx.packPurchase.updateMany).not.toHaveBeenCalled();
    expect(tx.tokenLedger.create).not.toHaveBeenCalled();
  });
});
