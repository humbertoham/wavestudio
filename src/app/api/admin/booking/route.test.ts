import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
  createBookingWithCreditCheck: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
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

function adminBookingRequest(body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/booking", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/admin/booking", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue({ sub: "admin_1", role: "ADMIN" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates user bookings through the shared credit-check helper", async () => {
    const tx = {
      booking: {
        findUnique: vi.fn().mockResolvedValue({
          id: "booking_1",
          class: {
            id: "class_1",
            title: "Pilates",
            date: new Date("2026-02-01T16:00:00.000Z"),
          },
          user: {
            id: "user_1",
            email: "user@example.test",
          },
        }),
      },
    };
    mocks.createBookingWithCreditCheck.mockResolvedValue({ id: "booking_1" });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx)
    );

    const res = await POST(
      adminBookingRequest({ userId: "user_1", classId: "class_1" })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.createBookingWithCreditCheck).toHaveBeenCalledWith(tx, {
      classId: "class_1",
      userId: "user_1",
      quantity: 1,
    });
  });

  it("rejects admin-created user bookings when the helper reports insufficient credits", async () => {
    mocks.createBookingWithCreditCheck.mockRejectedValue({
      code: "NO_CREDITS_AVAILABLE",
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({ booking: { findUnique: vi.fn() } })
    );

    const res = await POST(
      adminBookingRequest({ userId: "user_1", classId: "class_1" })
    );

    await expect(res.json()).resolves.toEqual({
      error: "NO_CREDITS_AVAILABLE",
    });
    expect(res.status).toBe(409);
  });
});
