import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createBooking: vi.fn() }));
vi.mock("@/lib/class-booking", () => ({
  createSingleSeatBookingWithDebit: mocks.createBooking,
  isManagedBookingError: (error: unknown) =>
    !!error && typeof error === "object" && "code" in error,
}));

import { promoteWaitlistForReleasedSeats } from "./waitlist-promotion";

function makeTx() {
  return { waitlist: {
    findMany: vi.fn().mockResolvedValue([
      { id: "entry_1", userId: "user_1" },
      { id: "entry_2", userId: "user_2" },
    ]),
    delete: vi.fn().mockResolvedValue({}),
  } };
}

describe("unlimited waitlist promotion", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["UNLIMITED_ENTITLEMENT_REVOKED", "UNLIMITED_DAILY_LIMIT", "NO_CREDITS_AVAILABLE"])(
    "retains an unfunded entry after %s and promotes the next eligible user", async (code) => {
      const tx = makeTx();
      mocks.createBooking.mockRejectedValueOnce({ code }).mockResolvedValueOnce({ id: "booking_2" });

      await expect(promoteWaitlistForReleasedSeats(tx as any, {
        classId: "class_1", seatsReleased: 1,
      })).resolves.toBe(1);

      expect(tx.waitlist.delete).toHaveBeenCalledTimes(1);
      expect(tx.waitlist.delete).toHaveBeenCalledWith({ where: { id: "entry_2" } });
      expect(mocks.createBooking).toHaveBeenNthCalledWith(2, tx, {
        classId: "class_1", userId: "user_2",
      });
    },
  );

  it("propagates a daily-claim constraint conflict for a complete transaction retry", async () => {
    const tx = makeTx();
    const conflict = { code: "P2002", meta: { target: "UnlimitedUsage_one_consumed_day" } };
    mocks.createBooking.mockRejectedValueOnce(conflict);

    await expect(promoteWaitlistForReleasedSeats(tx as any, {
      classId: "class_1", seatsReleased: 1,
    })).rejects.toBe(conflict);

    expect(tx.waitlist.delete).not.toHaveBeenCalled();
    expect(mocks.createBooking).toHaveBeenCalledOnce();
  });
});
