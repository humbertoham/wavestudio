import { BookingStatus, Prisma } from "@prisma/client";

import { lockChallengeTransaction } from "@/lib/challenge";
import { prisma } from "@/lib/prisma";

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

export type ClassDeletionResult =
  | { outcome: "not_found" }
  | {
      outcome: "blocked";
      activeBookingCount: number;
      activeWaitlistCount: number;
    }
  | { outcome: "deleted" }
  | { outcome: "archived"; inactiveBookingCount: number };

const MAX_CLASS_DELETION_ATTEMPTS = 3;

function isConcurrentClassDeletionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2003")
  );
}

/**
 * Canonical deletion used by both class-management entry points.
 *
 * Classes without history are physically removed. Classes with inactive
 * booking history are archived with deletedAt so attendance/refund/ledger and
 * Challenge audit relations remain intact without presenting the class as a
 * cancellation. Active bookings or waitlist entries must be resolved first.
 */
export async function deleteClassFromCalendar(
  classId: string
): Promise<ClassDeletionResult> {
  for (let attempt = 1; attempt <= MAX_CLASS_DELETION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockChallengeTransaction(tx);

          const cls = await tx.class.findUnique({
            where: { id: classId },
            select: { id: true, deletedAt: true },
          });

          if (!cls || cls.deletedAt) return { outcome: "not_found" };

          const dependencies = await countActiveClassDependencies(tx, classId);
          if (
            dependencies.activeBookingCount > 0 ||
            dependencies.activeWaitlistCount > 0
          ) {
            return { outcome: "blocked", ...dependencies };
          }

          const inactiveBookingCount = await tx.booking.count({
            where: inactiveBookingWhere(classId),
          });

          if (inactiveBookingCount > 0) {
            await tx.class.update({
              where: { id: classId },
              data: { deletedAt: new Date() },
            });
            return { outcome: "archived", inactiveBookingCount };
          }

          await tx.class.delete({ where: { id: classId } });
          return { outcome: "deleted" };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (
        isConcurrentClassDeletionError(error) &&
        attempt < MAX_CLASS_DELETION_ATTEMPTS
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("CLASS_DELETE_RETRY_EXHAUSTED");
}

export function classDeletionErrorCode(error: unknown) {
  return isConcurrentClassDeletionError(error) ||
    (error instanceof Error && error.message === "CLASS_DELETE_RETRY_EXHAUSTED")
    ? "CLASS_DELETE_CONFLICT"
    : "UNEXPECTED_ERROR";
}
