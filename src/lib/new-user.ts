import { BookingStatus, Prisma } from "@prisma/client";

type BookingHistoryClient = Pick<Prisma.TransactionClient, "booking">;

export type NewUserCandidateBooking = {
  id: string;
  userId: string | null;
  status: BookingStatus;
  createdAt: Date;
};

export async function getNewUserBookingIds(
  client: BookingHistoryClient,
  bookings: NewUserCandidateBooking[],
  currentClassIsCanceled: boolean
) {
  if (currentClassIsCanceled) return new Set<string>();

  const candidates = bookings.filter(
    (booking): booking is NewUserCandidateBooking & { userId: string } =>
      booking.status === BookingStatus.ACTIVE && Boolean(booking.userId)
  );

  if (!candidates.length) return new Set<string>();

  // A booking is NEW USER only when no earlier qualifying reservation exists.
  // Attendance is intentionally not part of the rule: the earliest qualifying
  // reservation keeps its badge after attendance, while later ones stay false.
  // The strict createdAt/id ordering excludes the current booking itself while
  // keeping the lookup batched for every registered participant in the roster.
  const previousBookings = await client.booking.findMany({
    where: {
      status: BookingStatus.ACTIVE,
      class: { is: { isCanceled: false } },
      OR: candidates.map((booking) => ({
        userId: booking.userId,
        OR: [
          { createdAt: { lt: booking.createdAt } },
          {
            createdAt: booking.createdAt,
            id: { lt: booking.id },
          },
        ],
      })),
    },
    select: { userId: true },
    distinct: ["userId"],
  });

  const experiencedUserIds = new Set(
    previousBookings
      .map((booking) => booking.userId)
      .filter((userId): userId is string => Boolean(userId))
  );

  return new Set(
    candidates
      .filter((booking) => !experiencedUserIds.has(booking.userId))
      .map((booking) => booking.id)
  );
}
