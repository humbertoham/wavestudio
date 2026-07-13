import { BookingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { getNewUserBookingIds, type NewUserCandidateBooking } from "./new-user";

function booking(
  overrides: Partial<NewUserCandidateBooking> = {}
): NewUserCandidateBooking {
  return {
    id: "booking_current",
    userId: "user_1",
    status: BookingStatus.ACTIVE,
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    ...overrides,
  };
}

function client(previousUserIds: Array<string | null> = []) {
  return {
    booking: {
      findMany: vi.fn().mockResolvedValue(
        previousUserIds.map((userId) => ({ userId }))
      ),
    },
  };
}

describe("getNewUserBookingIds", () => {
  it("marks a first qualifying booking as NEW USER and excludes itself", async () => {
    const db = client();
    const current = booking();

    await expect(
      getNewUserBookingIds(db as any, [current], false)
    ).resolves.toEqual(new Set([current.id]));

    expect(db.booking.findMany).toHaveBeenCalledWith({
      where: {
        status: BookingStatus.ACTIVE,
        class: { is: { isCanceled: false } },
        OR: [
          {
            userId: "user_1",
            OR: [
              { createdAt: { lt: current.createdAt } },
              {
                createdAt: current.createdAt,
                id: { lt: current.id },
              },
            ],
          },
        ],
      },
      select: { userId: true },
      distinct: ["userId"],
    });
  });

  it("does not mark an experienced user's later booking", async () => {
    const db = client(["user_1"]);

    await expect(
      getNewUserBookingIds(db as any, [booking()], false)
    ).resolves.toEqual(new Set());
  });

  it("ignores cancelled current rows and guests", async () => {
    const db = client();

    await expect(
      getNewUserBookingIds(
        db as any,
        [
          booking({ status: BookingStatus.CANCELED }),
          booking({ id: "guest", userId: null }),
        ],
        false
      )
    ).resolves.toEqual(new Set());

    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("does not classify bookings in a cancelled class", async () => {
    const db = client();

    await expect(
      getNewUserBookingIds(db as any, [booking()], true)
    ).resolves.toEqual(new Set());

    expect(db.booking.findMany).not.toHaveBeenCalled();
  });

  it("batches multiple affiliations and users into one history query", async () => {
    const db = client(["experienced"]);
    const candidates = [
      booking({ id: "package_booking", userId: "package_user" }),
      booking({ id: "wellhub_booking", userId: "wellhub_user" }),
      booking({ id: "totalpass_booking", userId: "experienced" }),
      booking({ id: "manual_booking", userId: "manual_user" }),
    ];

    const result = await getNewUserBookingIds(db as any, candidates, false);

    expect(result).toEqual(
      new Set(["package_booking", "wellhub_booking", "manual_booking"])
    );
    expect(db.booking.findMany).toHaveBeenCalledTimes(1);
  });
});
