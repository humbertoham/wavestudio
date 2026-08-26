import { syncFutureWellhubClasses } from "../src/lib/wellhub/booking/sync";
import { notifyWellhubBookingCanceledByWaveSafely } from "../src/lib/wellhub/booking/service";
import { reconcilePendingWellhubBookingConfirmations } from "../src/lib/wellhub/booking/service";
import { prisma } from "../src/lib/prisma";

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((arg) => arg !== "--dry-run");
if (unknown.length) {
  console.error("Usage: npm run wellhub:booking:sync -- [--dry-run]");
  process.exit(1);
}

try {
  const result = await syncFutureWellhubClasses({ dryRun: args.has("--dry-run") });
  let pendingCancellationNotifications = 0;
  let cancellationNotificationsFailed = 0;
  let pendingConfirmations = { discovered: 0, confirmed: 0, failed: 0 };
  if (!result.dryRun) {
    pendingConfirmations = await reconcilePendingWellhubBookingConfirmations();
    const pending = await prisma.booking.findMany({
      where: {
        source: "WELLHUB",
        status: "CANCELED",
        wellhubBookingNumber: { not: null },
        wellhubState: {
          in: ["RESERVED", "PENDING_CONFIRMATION", "CONFIRMATION_ERROR"],
        },
      },
      select: { id: true },
      take: 500,
    });
    pendingCancellationNotifications = pending.length;
    for (const booking of pending) {
      const notified = await notifyWellhubBookingCanceledByWaveSafely(booking.id);
      if (notified.kind === "error") cancellationNotificationsFailed += 1;
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: result.failed === 0,
        dryRun: result.dryRun,
        horizon: result.horizon.toISOString(),
        discovered: result.classes.length,
        synced: result.synced,
        failed: result.failed,
        pendingCancellationNotifications,
        cancellationNotificationsFailed,
        pendingConfirmations,
        classes: result.dryRun
          ? result.classes.map((item) => ({
              id: item.id,
              date: item.date.toISOString(),
              canceled: item.isCanceled,
            }))
          : undefined,
      },
      null,
      2
    )
  );
  if (
    result.failed > 0 ||
    cancellationNotificationsFailed > 0 ||
    pendingConfirmations.failed > 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    })
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
