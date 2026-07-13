import { BookingStatus, Prisma } from "@prisma/client";

type ClassDependencyClient = Pick<
  Prisma.TransactionClient,
  "booking" | "waitlist"
>;

export function activeBookingWhere(classId: string): Prisma.BookingWhereInput {
  return {
    classId,
    status: BookingStatus.ACTIVE,
  };
}

export function activeWaitlistWhere(classId: string): Prisma.WaitlistWhereInput {
  // Waitlist rows have no status or cancellation field. Leaving the waitlist
  // physically removes the row, so every row that still exists is active.
  return { classId };
}

export async function countActiveClassDependencies(
  tx: ClassDependencyClient,
  classId: string
) {
  const [activeBookingCount, activeWaitlistCount] = await Promise.all([
    tx.booking.count({ where: activeBookingWhere(classId) }),
    tx.waitlist.count({ where: activeWaitlistWhere(classId) }),
  ]);

  return { activeBookingCount, activeWaitlistCount };
}

export function inactiveBookingWhere(classId: string): Prisma.BookingWhereInput {
  return {
    classId,
    status: { not: BookingStatus.ACTIVE },
  };
}
