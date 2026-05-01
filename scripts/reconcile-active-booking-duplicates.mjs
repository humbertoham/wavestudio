import { BookingStatus, Prisma, PrismaClient, TokenReason } from "@prisma/client";

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");

function groupLabel(group) {
  return `userId=${group.userId} classId=${group.classId}`;
}

function normalizeGroup(row) {
  return {
    userId: String(row.userId),
    classId: String(row.classId),
    rowCount: Number(row.rowCount),
    mergedQuantity: Number(row.mergedQuantity),
  };
}

async function findDuplicateGroups(db) {
  const rows = await db.$queryRaw`
    SELECT
      "userId",
      "classId",
      COUNT(*)::int AS "rowCount",
      COALESCE(SUM(quantity), 0)::int AS "mergedQuantity"
    FROM "Booking"
    WHERE "status" = 'ACTIVE'
      AND "userId" IS NOT NULL
    GROUP BY "userId", "classId"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, MIN("createdAt") ASC
  `;

  return rows.map(normalizeGroup);
}

async function loadGroupRows(db, group) {
  return db.booking.findMany({
    where: {
      userId: group.userId,
      classId: group.classId,
      status: BookingStatus.ACTIVE,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      userId: true,
      classId: true,
      status: true,
      quantity: true,
      attended: true,
      createdAt: true,
      canceledAt: true,
      refundToken: true,
      packPurchaseId: true,
      ledgerEntries: {
        select: {
          id: true,
          bookingId: true,
          delta: true,
          reason: true,
          packPurchaseId: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}

function assertSafeToMerge(rows, group) {
  if (rows.length < 2) {
    throw new Error(
      `Expected duplicate rows for ${groupLabel(group)}, but found ${rows.length}.`
    );
  }

  const invalidQuantity = rows.find((row) => row.quantity < 1);
  if (invalidQuantity) {
    throw new Error(
      `Cannot merge ${groupLabel(group)} because booking ${invalidQuantity.id} has quantity < 1.`
    );
  }

  const invalidStatus = rows.find((row) => row.status !== BookingStatus.ACTIVE);
  if (invalidStatus) {
    throw new Error(
      `Cannot merge ${groupLabel(group)} because booking ${invalidStatus.id} is not ACTIVE.`
    );
  }

  const unexpectedCanceledState = rows.find(
    (row) => row.canceledAt !== null || row.refundToken !== null
  );
  if (unexpectedCanceledState) {
    throw new Error(
      `Cannot merge ${groupLabel(group)} because booking ${unexpectedCanceledState.id} has canceled/refund state.`
    );
  }

  const refundedLedger = rows
    .flatMap((row) => row.ledgerEntries.map((entry) => ({ row, entry })))
    .find(({ entry }) => entry.reason === TokenReason.CANCEL_REFUND);

  if (refundedLedger) {
    throw new Error(
      `Cannot merge ${groupLabel(group)} because booking ${refundedLedger.row.id} already has CANCEL_REFUND ledger entries.`
    );
  }
}

function summarizeRows(rows) {
  return rows.map((row, index) => {
    const debitCount = row.ledgerEntries.filter(
      (entry) => entry.reason === TokenReason.BOOKING_DEBIT
    ).length;
    const debitTotal = row.ledgerEntries
      .filter((entry) => entry.reason === TokenReason.BOOKING_DEBIT)
      .reduce((sum, entry) => sum + Math.abs(entry.delta), 0);

    return {
      role: index === 0 ? "canonical" : "duplicate",
      bookingId: row.id,
      quantity: row.quantity,
      debitEntries: debitCount,
      debitTotal,
      attended: row.attended,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function preview() {
  const groups = await findDuplicateGroups(prisma);

  if (groups.length === 0) {
    console.log("No duplicate ACTIVE bookings found.");
    return;
  }

  console.log(`Found ${groups.length} duplicate ACTIVE booking group(s).`);

  for (const group of groups) {
    const rows = await loadGroupRows(prisma, group);
    assertSafeToMerge(rows, group);

    console.log("");
    console.log(`${groupLabel(group)} rows=${group.rowCount} mergedQuantity=${group.mergedQuantity}`);

    for (const row of summarizeRows(rows)) {
      console.log(
        `  - ${row.role} bookingId=${row.bookingId} quantity=${row.quantity} debitEntries=${row.debitEntries} debitTotal=${row.debitTotal} attended=${row.attended} createdAt=${row.createdAt}`
      );
    }
  }

  console.log("");
  console.log("Dry run only. Re-run with --execute to apply the merge transaction.");
}

async function execute() {
  const report = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        'LOCK TABLE "Booking" IN SHARE ROW EXCLUSIVE MODE'
      );
      await tx.$executeRawUnsafe(
        'LOCK TABLE "TokenLedger" IN SHARE ROW EXCLUSIVE MODE'
      );

      const groups = await findDuplicateGroups(tx);
      const now = new Date();
      const applied = [];

      for (const group of groups) {
        const rows = await loadGroupRows(tx, group);
        assertSafeToMerge(rows, group);

        const [canonical, ...duplicates] = rows;
        const duplicateIds = duplicates.map((row) => row.id);
        const mergedQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
        const mergedAttended = rows.some((row) => row.attended);

        const reassignedLedgers = duplicateIds.length
          ? await tx.tokenLedger.updateMany({
              where: { bookingId: { in: duplicateIds } },
              data: { bookingId: canonical.id },
            })
          : { count: 0 };

        await tx.booking.update({
          where: { id: canonical.id },
          data: {
            quantity: mergedQuantity,
            attended: mergedAttended,
          },
        });

        if (duplicateIds.length) {
          await tx.booking.updateMany({
            where: { id: { in: duplicateIds } },
            data: {
              status: BookingStatus.CANCELED,
              canceledAt: now,
            },
          });
        }

        applied.push({
          group: groupLabel(group),
          canonicalBookingId: canonical.id,
          canceledBookingIds: duplicateIds,
          mergedQuantity,
          reassignedLedgerCount: reassignedLedgers.count,
        });
      }

      return applied;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    }
  );

  if (report.length === 0) {
    console.log("No duplicate ACTIVE bookings found.");
    return;
  }

  console.log(`Merged ${report.length} duplicate ACTIVE booking group(s).`);

  for (const item of report) {
    console.log("");
    console.log(item.group);
    console.log(`  canonicalBookingId=${item.canonicalBookingId}`);
    console.log(`  mergedQuantity=${item.mergedQuantity}`);
    console.log(`  reassignedLedgerCount=${item.reassignedLedgerCount}`);
    console.log(
      `  canceledBookingIds=${item.canceledBookingIds.length ? item.canceledBookingIds.join(", ") : "(none)"}`
    );
  }
}

try {
  if (EXECUTE) {
    await execute();
  } else {
    await preview();
  }
} catch (error) {
  console.error(
    EXECUTE
      ? "Failed to merge duplicate ACTIVE bookings."
      : "Duplicate ACTIVE booking preview failed."
  );
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
