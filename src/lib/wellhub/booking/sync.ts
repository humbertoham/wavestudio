import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createWellhubBookingClient,
  WellhubBookingApiError,
  type WellhubBookingClient,
  type WellhubClassPayload,
  type WellhubSlotPayload,
} from "@/lib/wellhub/booking/client";
import {
  getWellhubBookingConfig,
  WellhubConfigError,
  type WellhubBookingConfig,
} from "@/lib/wellhub/config";
import { prisma } from "@/lib/prisma";

type EnabledBookingConfig = Extract<WellhubBookingConfig, { enabled: true }>;

export type WellhubClassSyncResult =
  | {
      kind: "synced";
      classId: string;
      wellhubClassId: string;
      wellhubSlotId: string;
      activeBookingCount: number;
    }
  | { kind: "skipped"; reason: "DISABLED" | "NOT_FOUND" | "PAST_UNMAPPED" }
  | { kind: "error"; code: string };

function errorCode(error: unknown) {
  if (
    error instanceof WellhubBookingApiError ||
    error instanceof WellhubConfigError
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name.slice(0, 120) : "UNKNOWN_ERROR";
}

function activeConfig(config?: WellhubBookingConfig) {
  return config ?? getWellhubBookingConfig();
}

function classPayload(
  cls: {
    id: string;
    title: string;
    focus: string;
    location: string | null;
    isCanceled: boolean;
    deletedAt: Date | null;
  },
  config: EnabledBookingConfig
): WellhubClassPayload {
  const active = !cls.isCanceled && !cls.deletedAt;
  const description = cls.focus.trim() || cls.title.trim();
  return {
    name: cls.title.trim().slice(0, 255),
    description: description.slice(0, 1000),
    ...(cls.location?.trim() ? { notes: cls.location.trim().slice(0, 500) } : {}),
    bookable: active,
    visible: active,
    reference: cls.id,
    product_id: config.productId,
    ...(config.categoryIds.length ? { categories: config.categoryIds } : {}),
  };
}

function slotPayload(
  cls: {
    date: Date;
    durationMin: number;
    capacity: number;
    cancelBeforeMin: number | null;
    location: string | null;
    isCanceled: boolean;
    deletedAt: Date | null;
    instructor: { name: string };
  },
  activeBookingCount: number,
  config: EnabledBookingConfig
): WellhubSlotPayload {
  if (activeBookingCount > cls.capacity) {
    throw new WellhubBookingApiError("CAPACITY_BELOW_ACTIVE_BOOKINGS");
  }

  const cancellationMinutes = Math.min(
    24 * 60,
    Math.max(0, cls.cancelBeforeMin ?? 240)
  );
  const cancellableUntil = new Date(
    cls.date.getTime() - cancellationMinutes * 60_000
  );

  return {
    occur_date: cls.date.toISOString(),
    ...(cls.location?.trim() && cls.location.trim().length >= 2
      ? { room: cls.location.trim().slice(0, 200) }
      : {}),
    status: cls.isCanceled || cls.deletedAt ? 0 : 1,
    length_in_minutes: cls.durationMin,
    total_capacity: cls.capacity,
    total_booked: activeBookingCount,
    product_id: config.productId,
    cancellable_until: cancellableUntil.toISOString(),
    instructors: [
      { name: cls.instructor.name.trim().slice(0, 100), substitute: false },
    ],
    virtual: false,
  };
}

async function validateConfiguredCategories(
  client: WellhubBookingClient,
  categoryIds: number[]
) {
  if (!categoryIds.length) return;
  const available = await client.listCategoryIds("es_MX");
  const missing = categoryIds.filter((id) => !available.has(id));
  if (missing.length) {
    throw new WellhubBookingApiError("UNKNOWN_WELLHUB_CATEGORY_ID");
  }
}

function sameInstant(value: string, expected: Date) {
  const parsed = new Date(value.replace(/\[UTC\]$/, ""));
  return (
    Number.isFinite(parsed.getTime()) &&
    Math.abs(parsed.getTime() - expected.getTime()) < 1000
  );
}

export async function syncWellhubClass(
  classId: string,
  dependencies: {
    db?: PrismaClient;
    config?: WellhubBookingConfig;
    client?: WellhubBookingClient;
  } = {}
): Promise<WellhubClassSyncResult> {
  const config = activeConfig(dependencies.config);
  if (!config.enabled) return { kind: "skipped", reason: "DISABLED" };
  const db = dependencies.db ?? prisma;
  const client = dependencies.client ?? createWellhubBookingClient(config);

  return db.$transaction(async (tx) => {
    // A transaction-scoped advisory lock serializes sync for this WAVE class
    // across server instances and prevents duplicate external resources.
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${classId}))`
    );

    const cls = await tx.class.findUnique({
      where: { id: classId },
      include: { instructor: { select: { name: true } } },
    });
    if (!cls) return { kind: "skipped", reason: "NOT_FOUND" } as const;

    if (
      cls.date.getTime() <= Date.now() &&
      !cls.wellhubClassId &&
      !cls.wellhubSlotId
    ) {
      return { kind: "skipped", reason: "PAST_UNMAPPED" } as const;
    }

    const aggregate = await tx.booking.aggregate({
      where: { classId, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    const activeBookingCount = aggregate._sum.quantity ?? 0;

    await validateConfiguredCategories(client, config.categoryIds);
    const waveClassPayload = classPayload(cls, config);

    let wellhubClassId = cls.wellhubClassId;
    if (!wellhubClassId) {
      const existing = (await client.listClasses()).find(
        (item) => item.reference === classId
      );
      wellhubClassId =
        existing?.id ?? (await client.createClass(waveClassPayload));
      await tx.class.update({
        where: { id: classId },
        data: { wellhubClassId, wellhubSyncStatus: "PENDING" },
      });
    } else {
      await client.updateClass(wellhubClassId, waveClassPayload);
    }

    const waveSlotPayload = slotPayload(cls, activeBookingCount, config);
    let wellhubSlotId = cls.wellhubSlotId;
    if (!wellhubSlotId) {
      const existingSlots = await client.listSlots(
        wellhubClassId,
        new Date(
          Math.min(
            cls.date.getTime() - 24 * 60 * 60_000,
            Date.now() - 60 * 24 * 60 * 60_000
          )
        ),
        new Date(cls.date.getTime() + 90 * 24 * 60 * 60_000)
      );
      const slotsForClass = existingSlots.filter(
        (item) => item.classId === wellhubClassId
      );
      const existing =
        slotsForClass.find((item) => sameInstant(item.occurDate, cls.date)) ??
        (slotsForClass.length === 1 ? slotsForClass[0] : undefined);
      wellhubSlotId =
        existing?.id ??
        (await client.createSlot(wellhubClassId, waveSlotPayload));
    } else {
      await client.updateSlot(wellhubClassId, wellhubSlotId, waveSlotPayload);
    }

    await tx.class.update({
      where: { id: classId },
      data: {
        wellhubClassId,
        wellhubSlotId,
        wellhubSyncStatus: "SYNCED",
        wellhubLastSyncedAt: new Date(),
        wellhubSyncError: null,
      },
    });

    return {
      kind: "synced",
      classId,
      wellhubClassId,
      wellhubSlotId,
      activeBookingCount,
    } as const;
  });
}

export async function syncWellhubClassSafely(
  classId: string,
  dependencies: Parameters<typeof syncWellhubClass>[1] = {}
): Promise<WellhubClassSyncResult> {
  try {
    const result = await syncWellhubClass(classId, dependencies);
    if (result.kind === "synced") {
      console.info("WELLHUB_BOOKING_CLASS_SYNCED", {
        classId,
        wellhubSlotId: result.wellhubSlotId,
        activeBookingCount: result.activeBookingCount,
      });
    }
    return result;
  } catch (error) {
    const code = errorCode(error);
    if (error instanceof WellhubConfigError) {
      console.error("WELLHUB_BOOKING_CLASS_SYNC_ERROR", { classId, code });
      return { kind: "error", code };
    }
    const db = dependencies.db ?? prisma;
    await db.class
      .updateMany({
        where: { id: classId },
        data: {
          wellhubSyncStatus: "ERROR",
          wellhubSyncError: code.slice(0, 300),
        },
      })
      .catch(() => undefined);
    console.error("WELLHUB_BOOKING_CLASS_SYNC_ERROR", { classId, code });
    return { kind: "error", code };
  }
}

export async function syncFutureWellhubClasses(
  options: {
    dryRun?: boolean;
    now?: Date;
    db?: PrismaClient;
    config?: WellhubBookingConfig;
    client?: WellhubBookingClient;
  } = {}
) {
  const config = activeConfig(options.config);
  if (!config.enabled) {
    throw new WellhubConfigError("WELLHUB_BOOKING_DISABLED");
  }
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();
  const horizon = new Date(
    now.getTime() + config.syncHorizonDays * 24 * 60 * 60_000
  );
  const classes = await db.class.findMany({
    where: {
      date: { gte: now, lte: horizon },
      OR: [
        { deletedAt: null },
        { wellhubClassId: { not: null } },
        { wellhubSlotId: { not: null } },
      ],
    },
    select: { id: true, title: true, date: true, isCanceled: true },
    orderBy: { date: "asc" },
    take: 500,
  });

  if (options.dryRun) {
    return { dryRun: true, horizon, classes, synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  for (const cls of classes) {
    const result = await syncWellhubClassSafely(cls.id, {
      db,
      config,
      client: options.client,
    });
    if (result.kind === "synced") synced += 1;
    if (result.kind === "error") failed += 1;
  }
  return { dryRun: false, horizon, classes, synced, failed };
}
