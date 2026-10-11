import type { Prisma } from "@prisma/client";
import { monthlyPeriod, type PackageSnapshot } from "@/lib/monthly-unlimited";

export async function assertNoMonthlyDuplicate(
  tx: Prisma.TransactionClient,
  userId: string,
  snapshot: PackageSnapshot,
  now = new Date(),
) {
  if (snapshot.type !== "MONTHLY_UNLIMITED") return;
  // Serialize checkouts for this account; pending payments also reserve the month.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`monthly-checkout:${userId}`}))`;
  if (
    monthlyPeriod(snapshot.unlimitedYear!, snapshot.unlimitedMonth!)
      .expiresAt <= now
  )
    throw { code: "UNLIMITED_NOT_ACTIVE" };
  const owned = await tx.packPurchase.findFirst({
    where: {
      userId,
      type: "MONTHLY_UNLIMITED",
      unlimitedMonth: snapshot.unlimitedMonth,
      unlimitedYear: snapshot.unlimitedYear,
      revokedAt: null,
    },
    select: { id: true },
  });
  const pending = await tx.payment.findFirst({
    where: {
      userId,
      status: "PENDING",
      packSnapshot: { path: ["periodKey"], equals: snapshot.periodKey! },
      checkoutLink: {
        is: { status: { in: ["CREATED", "OPEN"] }, expiresAt: { gt: now } },
      },
    },
    select: { id: true },
  });
  if (owned || pending) throw { code: "UNLIMITED_MONTH_ALREADY_PURCHASED" };
}
