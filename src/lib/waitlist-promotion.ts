import type { Prisma } from "@prisma/client";

import {
  createSingleSeatBookingWithDebit,
  isManagedBookingError,
} from "@/lib/class-booking";

/** Canonical FIFO promotion used whenever an active booking releases seats. */
export async function promoteWaitlistForReleasedSeats(
  tx: Prisma.TransactionClient,
  params: { classId: string; seatsReleased: number }
) {
  const entries = await tx.waitlist.findMany({
    where: { classId: params.classId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, userId: true },
  });

  let promotedSeats = 0;
  for (const entry of entries) {
    if (promotedSeats >= params.seatsReleased) break;

    try {
      await createSingleSeatBookingWithDebit(tx, {
        classId: params.classId,
        userId: entry.userId,
      });
      await tx.waitlist.delete({ where: { id: entry.id } });
      promotedSeats += 1;
    } catch (error) {
      if (
        isManagedBookingError(error) &&
        error.code === "NO_CREDITS_AVAILABLE"
      ) {
        continue;
      }

      if (
        isManagedBookingError(error) &&
        (error.code === "USER_ALREADY_BOOKED" ||
          error.code === "USER_NOT_FOUND" ||
          error.code === "BOOKING_BLOCKED")
      ) {
        await tx.waitlist.delete({ where: { id: entry.id } });
        continue;
      }

      if (
        isManagedBookingError(error) &&
        (error.code === "CLASS_ALREADY_STARTED" || error.code === "CLASS_FULL")
      ) {
        break;
      }

      throw error;
    }
  }

  return promotedSeats;
}
