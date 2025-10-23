// lib/availability.ts
import { prisma } from "@/lib/prisma";

export async function getRemainingSpots(classId: string) {
  const klass = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, capacity: true },
  });
  if (!klass) throw new Error("CLASS_NOT_FOUND");

  const agg = await prisma.booking.aggregate({
    where: { classId, status: "ACTIVE" },
    _sum: { quantity: true },
  });

  const occupied = agg._sum.quantity ?? 0;
  return Math.max(0, klass.capacity - occupied);
}
