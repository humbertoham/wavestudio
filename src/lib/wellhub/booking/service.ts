import { createHash } from "node:crypto";

import {
  Affiliation,
  Prisma,
  type PrismaClient,
  type WellhubBookingEventResult,
} from "@prisma/client";

import {
  createWellhubBookingClient,
  WellhubBookingApiError,
  type WellhubBookingClient,
  type WellhubBookingDecision,
} from "@/lib/wellhub/booking/client";
import type { WellhubBookingConfig } from "@/lib/wellhub/config";
import { getWellhubBookingConfig, WellhubConfigError } from "@/lib/wellhub/config";
import type { WellhubBookingEvent } from "@/lib/wellhub/parser";
import { prisma } from "@/lib/prisma";
import { promoteWaitlistForReleasedSeats } from "@/lib/waitlist-promotion";

type EnabledBookingConfig = Extract<WellhubBookingConfig, { enabled: true }>;

export type WellhubBookingProcessingResult =
  | {
      kind: "accepted";
      bookingId: string;
      classId: string;
      matchedUserId: string | null;
      activeBookingCount: number;
    }
  | { kind: "rejected"; code: WellhubRejectionCode }
  | {
      kind: "canceled";
      bookingId: string | null;
      classId: string | null;
      late: boolean;
      activeBookingCount: number | null;
    }
  | { kind: "duplicate"; status: WellhubBookingEventResult }
  | { kind: "error"; code: string; retryable: boolean };

type WellhubRejectionCode = Exclude<
  Extract<WellhubBookingDecision, { status: "REJECTED" }>["reason_category"],
  "TECHNICAL_ERROR"
>;

type EventClaim =
  | { kind: "claimed"; id: string; bookingId: string | null }
  | { kind: "duplicate"; status: WellhubBookingEventResult };

const MAX_SERIALIZABLE_RETRIES = 3;

function logReference(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
}

function isPrismaCode(error: unknown, code: string) {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code) ||
    (Boolean(error) &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === code)
  );
}

function integrationError(error: unknown) {
  if (
    error instanceof WellhubBookingApiError ||
    error instanceof WellhubConfigError
  ) {
    return {
      code: error.code,
      retryable:
        error instanceof WellhubBookingApiError && error.retryable,
    };
  }
  return {
    code: error instanceof Error ? error.name.slice(0, 120) : "UNKNOWN_ERROR",
    retryable: true,
  };
}

function parseEventTime(raw: string) {
  const numeric = Number(raw);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return new Date();
  const millis = raw.length <= 10 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

async function claimEvent(
  db: PrismaClient,
  event: WellhubBookingEvent
): Promise<EventClaim> {
  try {
    const created = await db.wellhubBookingEvent.create({
      data: {
        externalEventId: event.externalEventId,
        eventType: event.eventKind,
        bookingNumber: event.bookingNumber,
        externalUserId: event.externalUserId,
        externalSlotId: event.externalSlotId,
        externalClassId: event.externalClassId,
        externalGymId: event.externalGymId,
        eventTimestamp: event.eventTimestamp,
      },
      select: { id: true, bookingId: true },
    });
    return { kind: "claimed", ...created };
  } catch (error) {
    if (!isPrismaCode(error, "P2002")) throw error;
    const existing = await db.wellhubBookingEvent.findFirst({
      where: {
        OR: [
          { externalEventId: event.externalEventId },
          { eventType: event.eventKind, bookingNumber: event.bookingNumber },
        ],
      },
      select: { id: true, bookingId: true, result: true },
    });
    if (!existing) throw error;

    if (existing.result !== "ERROR") {
      return { kind: "duplicate", status: existing.result };
    }

    const claimed = await db.wellhubBookingEvent.updateMany({
      where: { id: existing.id, result: "ERROR" },
      data: { result: "PROCESSING", failureCode: null, processedAt: null },
    });
    return claimed.count === 1
      ? { kind: "claimed", id: existing.id, bookingId: existing.bookingId }
      : { kind: "duplicate", status: "PROCESSING" };
  }
}

function rejection(code: WellhubRejectionCode): WellhubBookingDecision {
  const messages: Record<WellhubRejectionCode, string> = {
    CLASS_IS_FULL: "Class is full",
    USER_IS_ALREADY_BOOKED: "User is already booked",
    SPOT_NOT_AVAILABLE: "Spot is not available",
    CHECK_IN_AND_CANCELATION_WINDOWS_CLOSED: "Booking window is closed",
    CLASS_HAS_BEEN_CANCELED: "Class has been canceled",
    CLASS_NOT_FOUND: "Class was not found",
    GENERAL_ERROR: "Booking could not be accepted",
  };
  return { status: "REJECTED", reason: messages[code], reason_category: code };
}

async function rejectInTransaction(
  tx: Prisma.TransactionClient,
  eventId: string,
  code: WellhubRejectionCode,
  classId?: string
) {
  await tx.wellhubBookingEvent.update({
    where: { id: eventId },
    data: {
      result: "REJECTED",
      failureCode: code,
      processedAt: new Date(),
      ...(classId ? { classId } : {}),
    },
  });
  return { kind: "rejected" as const, code };
}

type AcceptedLocal = {
  kind: "accepted";
  bookingId: string;
  classId: string;
  matchedUserId: string | null;
  wellhubClassId: string;
  wellhubSlotId: string;
  activeBookingCount: number;
};

async function createRequestedBooking(
  db: PrismaClient,
  eventRecordId: string,
  event: WellhubBookingEvent,
  config: EnabledBookingConfig
): Promise<AcceptedLocal | { kind: "rejected"; code: WellhubRejectionCode }> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          if (event.externalGymId !== config.gymId) {
            return rejectInTransaction(tx, eventRecordId, "CLASS_NOT_FOUND");
          }

          const cls = await tx.class.findFirst({
            where: {
              wellhubSlotId: event.externalSlotId,
              wellhubClassId: event.externalClassId,
            },
            select: {
              id: true,
              capacity: true,
              date: true,
              isCanceled: true,
              deletedAt: true,
              wellhubClassId: true,
              wellhubSlotId: true,
            },
          });
          if (!cls?.wellhubClassId || !cls.wellhubSlotId) {
            return rejectInTransaction(tx, eventRecordId, "CLASS_NOT_FOUND");
          }
          if (cls.isCanceled || cls.deletedAt) {
            return rejectInTransaction(
              tx,
              eventRecordId,
              "CLASS_HAS_BEEN_CANCELED",
              cls.id
            );
          }
          if (cls.date.getTime() <= Date.now()) {
            return rejectInTransaction(
              tx,
              eventRecordId,
              "CHECK_IN_AND_CANCELATION_WINDOWS_CLOSED",
              cls.id
            );
          }

          const existingExternal = await tx.booking.findUnique({
            where: { wellhubBookingNumber: event.bookingNumber },
            select: {
              id: true,
              classId: true,
              userId: true,
              status: true,
              source: true,
            },
          });
          if (existingExternal) {
            if (
              existingExternal.source === "WELLHUB" &&
              existingExternal.classId === cls.id &&
              existingExternal.status === "ACTIVE"
            ) {
              const aggregate = await tx.booking.aggregate({
                where: { classId: cls.id, status: "ACTIVE" },
                _sum: { quantity: true },
              });
              await tx.wellhubBookingEvent.update({
                where: { id: eventRecordId },
                data: {
                  bookingId: existingExternal.id,
                  classId: cls.id,
                  result: "ACCEPTED",
                  processedAt: new Date(),
                },
              });
              return {
                kind: "accepted",
                bookingId: existingExternal.id,
                classId: cls.id,
                matchedUserId: existingExternal.userId,
                wellhubClassId: cls.wellhubClassId,
                wellhubSlotId: cls.wellhubSlotId,
                activeBookingCount: aggregate._sum.quantity ?? 0,
              };
            }
            return rejectInTransaction(
              tx,
              eventRecordId,
              "GENERAL_ERROR",
              cls.id
            );
          }

          let matchedUserId: string | null = null;
          if (event.email) {
            const user = await tx.user.findUnique({
              where: { email: event.email },
              select: { id: true, affiliation: true },
            });
            if (user?.affiliation === Affiliation.WELLHUB) {
              matchedUserId = user.id;
            }
          }

          const externalUserAlreadyBooked = await tx.booking.findFirst({
            where: {
              classId: cls.id,
              source: "WELLHUB",
              wellhubUserId: event.externalUserId,
              status: "ACTIVE",
            },
            select: { id: true },
          });
          if (externalUserAlreadyBooked) {
            return rejectInTransaction(
              tx,
              eventRecordId,
              "USER_IS_ALREADY_BOOKED",
              cls.id
            );
          }

          if (matchedUserId) {
            const alreadyBooked = await tx.booking.findFirst({
              where: { classId: cls.id, userId: matchedUserId, status: "ACTIVE" },
              select: { id: true },
            });
            if (alreadyBooked) {
              return rejectInTransaction(
                tx,
                eventRecordId,
                "USER_IS_ALREADY_BOOKED",
                cls.id
              );
            }
          }

          const aggregate = await tx.booking.aggregate({
            where: { classId: cls.id, status: "ACTIVE" },
            _sum: { quantity: true },
          });
          const usedSpots = aggregate._sum.quantity ?? 0;
          if (usedSpots >= cls.capacity) {
            return rejectInTransaction(
              tx,
              eventRecordId,
              "CLASS_IS_FULL",
              cls.id
            );
          }

          const booking = await tx.booking.create({
            data: {
              classId: cls.id,
              userId: matchedUserId,
              guestName: matchedUserId
                ? null
                : (event.displayName?.trim().slice(0, 200) ?? "Wellhub member"),
              quantity: 1,
              status: "ACTIVE",
              source: "WELLHUB",
              packPurchaseId: null,
              wellhubBookingNumber: event.bookingNumber,
              wellhubUserId: event.externalUserId,
              wellhubSlotId: event.externalSlotId,
              wellhubState: "PENDING_CONFIRMATION",
              wellhubLastEventAt: parseEventTime(event.eventTimestamp),
            },
            select: { id: true },
          });

          await tx.wellhubBookingEvent.update({
            where: { id: eventRecordId },
            data: {
              bookingId: booking.id,
              classId: cls.id,
              result: "ACCEPTED",
              processedAt: new Date(),
            },
          });

          return {
            kind: "accepted",
            bookingId: booking.id,
            classId: cls.id,
            matchedUserId,
            wellhubClassId: cls.wellhubClassId,
            wellhubSlotId: cls.wellhubSlotId,
            activeBookingCount: usedSpots + 1,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (
        (isPrismaCode(error, "P2034") || isPrismaCode(error, "P2002")) &&
        attempt < MAX_SERIALIZABLE_RETRIES - 1
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new WellhubBookingApiError("BOOKING_TRANSACTION_RETRY_EXHAUSTED", undefined, true);
}

async function confirmAccepted(
  db: PrismaClient,
  client: WellhubBookingClient,
  eventRecordId: string,
  event: WellhubBookingEvent,
  local: AcceptedLocal
): Promise<WellhubBookingProcessingResult> {
  const [decisionResult, countResult] = await Promise.allSettled([
    client.decideBooking(event.bookingNumber, { status: "RESERVED" }),
    client.updateCapacity(local.wellhubClassId, local.wellhubSlotId, {
      total_capacity: await db.class
        .findUnique({ where: { id: local.classId }, select: { capacity: true } })
        .then((row) => row?.capacity ?? local.activeBookingCount),
      total_booked: local.activeBookingCount,
    }),
  ]);

  if (countResult.status === "rejected") {
    const failure = integrationError(countResult.reason);
    await db.class.updateMany({
      where: { id: local.classId },
      data: { wellhubSyncStatus: "ERROR", wellhubSyncError: failure.code },
    });
  }

  if (decisionResult.status === "rejected") {
    const failure = integrationError(decisionResult.reason);
    await db.$transaction([
      db.booking.update({
        where: { id: local.bookingId },
        data: { wellhubState: "CONFIRMATION_ERROR" },
      }),
      db.wellhubBookingEvent.update({
        where: { id: eventRecordId },
        data: { result: "ERROR", failureCode: failure.code },
      }),
    ]);
    return { kind: "error", ...failure };
  }

  await db.booking.update({
    where: { id: local.bookingId },
    data: { wellhubState: "RESERVED" },
  });
  return {
    kind: "accepted",
    bookingId: local.bookingId,
    classId: local.classId,
    matchedUserId: local.matchedUserId,
    activeBookingCount: local.activeBookingCount,
  };
}

async function processRequested(
  db: PrismaClient,
  client: WellhubBookingClient,
  config: EnabledBookingConfig,
  eventRecordId: string,
  retryBookingId: string | null,
  event: WellhubBookingEvent
): Promise<WellhubBookingProcessingResult> {
  let local: AcceptedLocal | { kind: "rejected"; code: WellhubRejectionCode };

  if (retryBookingId) {
    const booking = await db.booking.findUnique({
      where: { id: retryBookingId },
      include: {
        class: {
          select: {
            id: true,
            wellhubClassId: true,
            wellhubSlotId: true,
          },
        },
      },
    });
    if (
      booking?.source === "WELLHUB" &&
      booking.status === "ACTIVE" &&
      booking.class.wellhubClassId &&
      booking.class.wellhubSlotId
    ) {
      const aggregate = await db.booking.aggregate({
        where: { classId: booking.classId, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      local = {
        kind: "accepted",
        bookingId: booking.id,
        classId: booking.classId,
        matchedUserId: booking.userId,
        wellhubClassId: booking.class.wellhubClassId,
        wellhubSlotId: booking.class.wellhubSlotId,
        activeBookingCount: aggregate._sum.quantity ?? 0,
      };
      await db.wellhubBookingEvent.update({
        where: { id: eventRecordId },
        data: { result: "ACCEPTED", processedAt: new Date() },
      });
    } else {
      local = await createRequestedBooking(db, eventRecordId, event, config);
    }
  } else {
    local = await createRequestedBooking(db, eventRecordId, event, config);
  }

  if (local.kind === "rejected") {
    try {
      await client.decideBooking(event.bookingNumber, rejection(local.code));
      return local;
    } catch (error) {
      const failure = integrationError(error);
      await db.wellhubBookingEvent.update({
        where: { id: eventRecordId },
        data: { result: "ERROR", failureCode: failure.code },
      });
      return { kind: "error", ...failure };
    }
  }

  return confirmAccepted(db, client, eventRecordId, event, local);
}

async function processCancellation(
  db: PrismaClient,
  client: WellhubBookingClient,
  config: EnabledBookingConfig,
  eventRecordId: string,
  event: WellhubBookingEvent
): Promise<WellhubBookingProcessingResult> {
  const late = event.eventKind === "LATE_CANCELED";

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      const local = await db.$transaction(
        async (tx) => {
          const booking = await tx.booking.findUnique({
            where: { wellhubBookingNumber: event.bookingNumber },
            include: {
              class: {
                select: { wellhubClassId: true, wellhubSlotId: true },
              },
            },
          });

          if (!booking) {
            await tx.wellhubBookingEvent.update({
              where: { id: eventRecordId },
              data: {
                result: "ERROR",
                failureCode: "BOOKING_NOT_FOUND",
                processedAt: new Date(),
              },
            });
            return null;
          }

          if (
            event.externalGymId !== config.gymId ||
            booking.source !== "WELLHUB" ||
            booking.wellhubUserId !== event.externalUserId ||
            booking.wellhubSlotId !== event.externalSlotId ||
            booking.class.wellhubClassId !== event.externalClassId
          ) {
            throw new WellhubBookingApiError("BOOKING_IDENTIFIER_MISMATCH");
          }

          if (booking.status === "ACTIVE") {
            await tx.booking.update({
              where: { id: booking.id },
              data: {
                status: "CANCELED",
                canceledAt: new Date(),
                refundToken: false,
                wellhubState: late ? "LATE_CANCELED" : "CANCELED",
                wellhubLateCanceledAt: late ? new Date() : null,
                wellhubLastEventAt: parseEventTime(event.eventTimestamp),
              },
            });
            await promoteWaitlistForReleasedSeats(tx, {
              classId: booking.classId,
              seatsReleased: booking.quantity ?? 1,
            });
          }

          const aggregate = await tx.booking.aggregate({
            where: { classId: booking.classId, status: "ACTIVE" },
            _sum: { quantity: true },
          });
          await tx.wellhubBookingEvent.update({
            where: { id: eventRecordId },
            data: {
              bookingId: booking.id,
              classId: booking.classId,
              result: "CANCELED",
              processedAt: new Date(),
            },
          });
          return {
            bookingId: booking.id,
            classId: booking.classId,
            wellhubClassId: booking.class.wellhubClassId,
            wellhubSlotId: booking.class.wellhubSlotId,
            activeBookingCount: aggregate._sum.quantity ?? 0,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (!local) {
        return { kind: "error", code: "BOOKING_NOT_FOUND", retryable: true };
      }

      if (local.wellhubClassId && local.wellhubSlotId) {
        const capacity = await db.class.findUnique({
          where: { id: local.classId },
          select: { capacity: true },
        });
        await client
          .updateCapacity(local.wellhubClassId, local.wellhubSlotId, {
            total_capacity: capacity?.capacity ?? local.activeBookingCount,
            total_booked: local.activeBookingCount,
          })
          .catch(async (error) => {
            const failure = integrationError(error);
            await db.class.updateMany({
              where: { id: local.classId },
              data: {
                wellhubSyncStatus: "ERROR",
                wellhubSyncError: failure.code,
              },
            });
          });
      }

      return {
        kind: "canceled",
        bookingId: local.bookingId,
        classId: local.classId,
        late,
        activeBookingCount: local.activeBookingCount,
      };
    } catch (error) {
      if (
        isPrismaCode(error, "P2034") &&
        attempt < MAX_SERIALIZABLE_RETRIES - 1
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new WellhubBookingApiError(
    "CANCEL_TRANSACTION_RETRY_EXHAUSTED",
    undefined,
    true
  );
}

export async function processWellhubBookingEvent(
  event: WellhubBookingEvent,
  config: EnabledBookingConfig,
  dependencies: { db?: PrismaClient; client?: WellhubBookingClient } = {}
): Promise<WellhubBookingProcessingResult> {
  const db = dependencies.db ?? prisma;
  const client = dependencies.client ?? createWellhubBookingClient(config);

  try {
    const claim = await claimEvent(db, event);
    if (claim.kind === "duplicate") return claim;

    return event.eventKind === "REQUESTED"
      ? await processRequested(
          db,
          client,
          config,
          claim.id,
          claim.bookingId,
          event
        )
      : await processCancellation(db, client, config, claim.id, event);
  } catch (error) {
    const failure = integrationError(error);
    console.error("WELLHUB_BOOKING_PROCESSING_ERROR", {
      eventType: event.eventType,
      externalEventHash: logReference(event.externalEventId),
      bookingReferenceHash: logReference(event.bookingNumber),
      code: failure.code,
    });
    return { kind: "error", ...failure };
  }
}

/** Notify Wellhub when WAVE/admin cancels an externally originated booking. */
export async function notifyWellhubBookingCanceledByWaveSafely(
  bookingId: string,
  dependencies: {
    db?: PrismaClient;
    config?: WellhubBookingConfig;
    client?: WellhubBookingClient;
  } = {}
) {
  try {
    const config = dependencies.config ?? getWellhubBookingConfig();
    if (!config.enabled) return { kind: "skipped" as const };
    const db = dependencies.db ?? prisma;
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        source: true,
        classId: true,
        wellhubBookingNumber: true,
        wellhubState: true,
      },
    });
    if (
      !booking ||
      booking.source !== "WELLHUB" ||
      !booking.wellhubBookingNumber ||
      booking.wellhubState === "CANCELED_BY_WAVE" ||
      booking.wellhubState === "CANCELED" ||
      booking.wellhubState === "LATE_CANCELED"
    ) {
      return { kind: "skipped" as const };
    }

    const client = dependencies.client ?? createWellhubBookingClient(config);
    await client.decideBooking(booking.wellhubBookingNumber, {
      status: "CANCELLED_BY_GYM",
      reason: "Canceled by WAVE",
    });
    await db.booking.update({
      where: { id: bookingId },
      data: { wellhubState: "CANCELED_BY_WAVE" },
    });
    return { kind: "notified" as const };
  } catch (error) {
    const failure = integrationError(error);
    console.error("WELLHUB_BOOKING_WAVE_CANCEL_NOTIFY_ERROR", {
      bookingId,
      code: failure.code,
    });
    return { kind: "error" as const, code: failure.code };
  }
}

/** Reconcile locally committed active bookings whose provider decision is pending. */
export async function reconcilePendingWellhubBookingConfirmations(
  dependencies: {
    db?: PrismaClient;
    config?: WellhubBookingConfig;
    client?: WellhubBookingClient;
  } = {}
) {
  const config = dependencies.config ?? getWellhubBookingConfig();
  if (!config.enabled) throw new WellhubConfigError("WELLHUB_BOOKING_DISABLED");
  const db = dependencies.db ?? prisma;
  const client = dependencies.client ?? createWellhubBookingClient(config);
  const pending = await db.booking.findMany({
    where: {
      source: "WELLHUB",
      status: "ACTIVE",
      wellhubBookingNumber: { not: null },
      wellhubState: { in: ["PENDING_CONFIRMATION", "CONFIRMATION_ERROR"] },
    },
    select: { id: true, wellhubBookingNumber: true },
    take: 500,
  });

  let confirmed = 0;
  let failed = 0;
  for (const booking of pending) {
    try {
      await client.decideBooking(booking.wellhubBookingNumber!, {
        status: "RESERVED",
      });
      await db.booking.update({
        where: { id: booking.id },
        data: { wellhubState: "RESERVED" },
      });
      await db.wellhubBookingEvent.updateMany({
        where: { bookingId: booking.id, result: { in: ["ERROR", "PROCESSING"] } },
        data: { result: "ACCEPTED", failureCode: null, processedAt: new Date() },
      });
      confirmed += 1;
    } catch {
      failed += 1;
    }
  }
  return { discovered: pending.length, confirmed, failed };
}
