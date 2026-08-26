import { describe, expect, it, vi } from "vitest";

import type { WellhubBookingClient } from "@/lib/wellhub/booking/client";
import { processWellhubBookingEvent } from "@/lib/wellhub/booking/service";
import type { WellhubBookingConfig } from "@/lib/wellhub/config";
import type { WellhubBookingEvent } from "@/lib/wellhub/parser";

const config = {
  enabled: true,
  apiBaseUrl: "https://apitesting.partners.gympass.com/booking/v1",
  apiToken: "fake",
  gymId: "129",
  productId: 100003,
  categoryIds: [],
  webhookSecret: "fake",
  timeoutMs: 800,
  syncHorizonDays: 30,
} satisfies WellhubBookingConfig;

function requested(
  suffix = "1",
  overrides: Partial<WellhubBookingEvent> = {}
): WellhubBookingEvent {
  return {
    eventType: "booking-requested",
    eventKind: "REQUESTED",
    externalEventId: `event-request-${suffix}`,
    externalUserId: `100000000000${suffix}`,
    externalGymId: "129",
    externalClassId: "8268",
    externalSlotId: "9325",
    bookingNumber: `BK_${suffix}`,
    eventTimestamp: "1664461204015",
    displayName: `Wellhub Member ${suffix}`,
    email: `member${suffix}@example.com`,
    ...overrides,
  };
}

function canceled(
  bookingNumber: string,
  externalUserId: string,
  late = false,
  suffix = "1"
): WellhubBookingEvent {
  return {
    eventType: late ? "booking-late-canceled" : "booking-canceled",
    eventKind: late ? "LATE_CANCELED" : "CANCELED",
    externalEventId: `event-cancel-${late ? "late" : "normal"}-${suffix}`,
    externalUserId,
    externalGymId: "129",
    externalClassId: "8268",
    externalSlotId: "9325",
    bookingNumber,
    eventTimestamp: "1664461205015",
  };
}

function uniqueError() {
  return Object.assign(new Error("unique"), { code: "P2002" });
}

function harness(options: {
  capacity?: number;
  canceled?: boolean;
  unknownSlot?: boolean;
  initialWaveBookings?: number;
  users?: Record<string, { id: string; affiliation: "WELLHUB" | "NONE" }>;
} = {}) {
  const classRow = {
    id: "wave_class_1",
    capacity: options.capacity ?? 2,
    date: new Date("2027-09-01T18:00:00.000Z"),
    isCanceled: options.canceled ?? false,
    deletedAt: null,
    wellhubClassId: "8268",
    wellhubSlotId: "9325",
    wellhubSyncStatus: "SYNCED",
    wellhubSyncError: null as string | null,
  };
  const bookings: any[] = Array.from(
    { length: options.initialWaveBookings ?? 0 },
    (_, index) => ({
      id: `wave_booking_${index}`,
      classId: classRow.id,
      userId: `wave_user_${index}`,
      guestName: null,
      quantity: 1,
      status: "ACTIVE",
      source: "WAVE",
      wellhubBookingNumber: null,
      wellhubUserId: null,
      wellhubSlotId: null,
      wellhubState: null,
    })
  );
  const events: any[] = [];
  const users = options.users ?? {};
  let bookingSequence = 0;

  const findBooking = (where: any) =>
    bookings.find((item) =>
      where.id
        ? item.id === where.id
        : item.wellhubBookingNumber === where.wellhubBookingNumber
    ) ?? null;
  const activeCount = () =>
    bookings
      .filter((item) => item.classId === classRow.id && item.status === "ACTIVE")
      .reduce((sum, item) => sum + (item.quantity ?? 1), 0);

  const tx: any = {
    class: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
        !options.unknownSlot &&
        where.wellhubSlotId === classRow.wellhubSlotId &&
        where.wellhubClassId === classRow.wellhubClassId
          ? { ...classRow }
          : null
      ),
      findUnique: vi.fn().mockResolvedValue({ ...classRow }),
      updateMany: vi.fn().mockImplementation(async ({ data }: any) => {
        Object.assign(classRow, data);
        return { count: 1 };
      }),
    },
    booking: {
      findUnique: vi.fn().mockImplementation(async ({ where, include }: any) => {
        const found = findBooking(where);
        return found && include?.class
          ? { ...found, class: { wellhubClassId: "8268", wellhubSlotId: "9325" } }
          : found
            ? { ...found }
            : null;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
        bookings.find(
          (item) =>
            item.classId === where.classId &&
            (where.wellhubUserId
              ? item.source === where.source &&
                item.wellhubUserId === where.wellhubUserId
              : item.userId === where.userId) &&
            item.status === where.status
        ) ?? null
      ),
      aggregate: vi.fn().mockImplementation(async () => ({
        _sum: { quantity: activeCount() },
      })),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        if (
          bookings.some(
            (item) => item.wellhubBookingNumber === data.wellhubBookingNumber
          )
        ) {
          throw uniqueError();
        }
        const booking = { id: `wellhub_booking_${++bookingSequence}`, ...data };
        bookings.push(booking);
        return { id: booking.id };
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const booking = findBooking(where);
        if (!booking) throw new Error("BOOKING_NOT_FOUND");
        Object.assign(booking, data);
        return { ...booking };
      }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
        users[where.email] ? { ...users[where.email] } : null
      ),
      create: vi.fn(),
    },
    waitlist: {
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
    packPurchase: {
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
      findMany: vi.fn(),
    },
    tokenLedger: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    wellhubBookingEvent: {
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const event = events.find((item) => item.id === where.id);
        if (!event) throw new Error("EVENT_NOT_FOUND");
        Object.assign(event, data);
        return { ...event };
      }),
    },
  };

  let mutex = Promise.resolve();
  const db: any = {
    ...tx,
    wellhubBookingEvent: {
      ...tx.wellhubBookingEvent,
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        if (
          events.some(
            (item) =>
              item.externalEventId === data.externalEventId ||
              (item.eventType === data.eventType &&
                item.bookingNumber === data.bookingNumber)
          )
        ) {
          throw uniqueError();
        }
        const event = {
          id: `stored_event_${events.length + 1}`,
          result: "PROCESSING",
          bookingId: null,
          ...data,
        };
        events.push(event);
        return { id: event.id, bookingId: event.bookingId };
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) =>
        events.find(
          (item) =>
            item.externalEventId === where.OR[0].externalEventId ||
            (item.eventType === where.OR[1].eventType &&
              item.bookingNumber === where.OR[1].bookingNumber)
        ) ?? null
      ),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const event = events.find(
          (item) => item.id === where.id && item.result === where.result
        );
        if (!event) return { count: 0 };
        Object.assign(event, data);
        return { count: 1 };
      }),
    },
    class: {
      ...tx.class,
      findUnique: vi.fn().mockResolvedValue({ ...classRow }),
      updateMany: tx.class.updateMany,
    },
    booking: tx.booking,
    $transaction: vi.fn().mockImplementation((value: any) => {
      if (Array.isArray(value)) return Promise.all(value);
      const run = mutex.then(() => value(tx));
      mutex = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }),
  };

  const client: WellhubBookingClient = {
    listCategoryIds: vi.fn(),
    listClasses: vi.fn(),
    createClass: vi.fn(),
    updateClass: vi.fn(),
    listSlots: vi.fn(),
    createSlot: vi.fn(),
    updateSlot: vi.fn(),
    updateCapacity: vi.fn().mockResolvedValue(undefined),
    decideBooking: vi.fn().mockResolvedValue(undefined),
  };

  return { db, tx, client, classRow, bookings, events, activeCount };
}

async function process(
  subject: ReturnType<typeof harness>,
  event: WellhubBookingEvent
) {
  return processWellhubBookingEvent(event, config, {
    db: subject.db,
    client: subject.client,
  });
}

describe("Wellhub booking request", () => {
  it("creates a real active Booking, confirms it, and synchronizes occupancy", async () => {
    const subject = harness({ capacity: 15, initialWaveBookings: 12 });
    const result = await process(subject, requested());
    expect(result).toMatchObject({
      kind: "accepted",
      classId: "wave_class_1",
      activeBookingCount: 13,
    });
    expect(subject.bookings.at(-1)).toMatchObject({
      status: "ACTIVE",
      source: "WELLHUB",
      quantity: 1,
      wellhubBookingNumber: "BK_1",
      packPurchaseId: null,
      wellhubState: "RESERVED",
    });
    expect(subject.client.decideBooking).toHaveBeenCalledWith("BK_1", {
      status: "RESERVED",
    });
    expect(subject.client.updateCapacity).toHaveBeenCalledWith("8268", "9325", {
      total_capacity: 15,
      total_booked: 13,
    });
  });

  it("does not debit credits, create packages/payments, or alter TotalPass", async () => {
    const subject = harness();
    await process(subject, requested());
    expect(subject.tx.packPurchase.update).not.toHaveBeenCalled();
    expect(subject.tx.packPurchase.updateMany).not.toHaveBeenCalled();
    expect(subject.tx.tokenLedger.create).not.toHaveBeenCalled();
    expect(subject.tx.user.create).not.toHaveBeenCalled();
    expect(subject.bookings.at(-1)?.packPurchaseId).toBeNull();
  });

  it("rejects full, canceled, and unknown slots with official categories", async () => {
    const full = harness({ capacity: 1, initialWaveBookings: 1 });
    await expect(process(full, requested("full"))).resolves.toEqual({
      kind: "rejected",
      code: "CLASS_IS_FULL",
    });
    expect(full.client.decideBooking).toHaveBeenCalledWith(
      "BK_full",
      expect.objectContaining({ reason_category: "CLASS_IS_FULL" })
    );

    const canceledClass = harness({ canceled: true });
    await expect(process(canceledClass, requested("canceled"))).resolves.toEqual({
      kind: "rejected",
      code: "CLASS_HAS_BEEN_CANCELED",
    });

    const unknown = harness({ unknownSlot: true });
    await expect(process(unknown, requested("unknown"))).resolves.toEqual({
      kind: "rejected",
      code: "CLASS_NOT_FOUND",
    });
  });

  it("is idempotent for duplicate event IDs and booking numbers", async () => {
    const subject = harness();
    const event = requested();
    await process(subject, event);
    expect(await process(subject, event)).toEqual({
      kind: "duplicate",
      status: "ACCEPTED",
    });
    expect(
      await process(subject, requested("other-event", { bookingNumber: "BK_1" }))
    ).toEqual({ kind: "duplicate", status: "ACCEPTED" });
    expect(subject.bookings.filter((item) => item.source === "WELLHUB")).toHaveLength(1);
  });

  it("rejects the same unmatched Wellhub user twice in one class", async () => {
    const subject = harness({ capacity: 3 });
    await process(subject, requested("1"));
    const second = requested("2", {
      externalUserId: "1000000000001",
      email: "different-unmatched@example.com",
    });
    await expect(process(subject, second)).resolves.toEqual({
      kind: "rejected",
      code: "USER_IS_ALREADY_BOOKED",
    });
    expect(subject.bookings.filter((item) => item.source === "WELLHUB")).toHaveLength(1);
  });

  it("allows exactly one of two concurrent requests for the final seat", async () => {
    const subject = harness({ capacity: 1 });
    const results = await Promise.all([
      process(subject, requested("1")),
      process(subject, requested("2")),
    ]);
    expect(results.filter((item) => item.kind === "accepted")).toHaveLength(1);
    expect(results.filter((item) => item.kind === "rejected")).toHaveLength(1);
    expect(subject.activeCount()).toBe(1);
  });

  it("matches only exact-email existing Wellhub users", async () => {
    const matched = harness({
      users: {
        "member1@example.com": { id: "wave_wellhub_user", affiliation: "WELLHUB" },
      },
    });
    await process(matched, requested());
    expect(matched.bookings.at(-1)).toMatchObject({
      userId: "wave_wellhub_user",
      guestName: null,
    });

    const unsafe = harness({
      users: {
        "member1@example.com": { id: "ordinary_wave_user", affiliation: "NONE" },
      },
    });
    await process(unsafe, requested());
    expect(unsafe.bookings.at(-1)).toMatchObject({
      userId: null,
      guestName: "Wellhub Member 1",
    });
    expect(unsafe.tx.user.create).not.toHaveBeenCalled();
  });

  it("preserves the local booking when confirmation fails and confirms on retry", async () => {
    const subject = harness();
    vi.mocked(subject.client.decideBooking).mockRejectedValueOnce(
      Object.assign(new Error("timeout"), {
        code: "WELLHUB_BOOKING_TIMEOUT",
        retryable: true,
      })
    );
    expect((await process(subject, requested())).kind).toBe("error");
    expect(subject.bookings.at(-1)?.wellhubState).toBe("CONFIRMATION_ERROR");

    expect((await process(subject, requested())).kind).toBe("accepted");
    expect(subject.bookings.filter((item) => item.source === "WELLHUB")).toHaveLength(1);
    expect(subject.bookings.at(-1)?.wellhubState).toBe("RESERVED");
    expect(subject.events[0]?.result).toBe("ACCEPTED");
  });
});

describe("Wellhub booking cancellation", () => {
  it("cancels the real booking, releases the seat, and never refunds credits", async () => {
    const subject = harness();
    await process(subject, requested());
    const result = await process(
      subject,
      canceled("BK_1", "1000000000001")
    );
    expect(result).toMatchObject({
      kind: "canceled",
      late: false,
      activeBookingCount: 0,
    });
    expect(subject.bookings.at(-1)).toMatchObject({
      status: "CANCELED",
      refundToken: false,
      wellhubState: "CANCELED",
    });
    expect(subject.tx.packPurchase.update).not.toHaveBeenCalled();
    expect(subject.tx.tokenLedger.create).not.toHaveBeenCalled();
    expect(subject.client.updateCapacity).toHaveBeenLastCalledWith("8268", "9325", {
      total_capacity: 2,
      total_booked: 0,
    });
  });

  it("handles repeated cancellation idempotently", async () => {
    const subject = harness();
    await process(subject, requested());
    const event = canceled("BK_1", "1000000000001");
    await process(subject, event);
    expect(await process(subject, event)).toEqual({
      kind: "duplicate",
      status: "CANCELED",
    });
    expect(subject.tx.booking.update).toHaveBeenCalledTimes(2); // confirmation + cancel
  });

  it("records late cancellation without applying WAVE monetary behavior", async () => {
    const subject = harness();
    await process(subject, requested());
    const result = await process(
      subject,
      canceled("BK_1", "1000000000001", true)
    );
    expect(result).toMatchObject({ kind: "canceled", late: true });
    expect(subject.bookings.at(-1)).toMatchObject({
      status: "CANCELED",
      wellhubState: "LATE_CANCELED",
    });
    expect(subject.tx.tokenLedger.create).not.toHaveBeenCalled();
  });
});
