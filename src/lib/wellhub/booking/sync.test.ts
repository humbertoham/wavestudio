import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WellhubBookingClient } from "@/lib/wellhub/booking/client";
import {
  syncWellhubClass,
  syncWellhubClassSafely,
} from "@/lib/wellhub/booking/sync";
import type { WellhubBookingConfig } from "@/lib/wellhub/config";

const config = {
  enabled: true,
  apiBaseUrl: "https://apitesting.partners.gympass.com/booking/v1",
  apiToken: "fake",
  gymId: "129",
  productId: 100003,
  categoryIds: [7],
  webhookSecret: "fake",
  timeoutMs: 800,
  syncHorizonDays: 30,
} satisfies WellhubBookingConfig;

function harness() {
  const cls = {
    id: "wave_class_1",
    title: "Pilates",
    focus: "Core",
    location: "Studio A",
    date: new Date("2027-09-01T18:00:00.000Z"),
    durationMin: 60,
    capacity: 15,
    cancelBeforeMin: 240,
    isCanceled: false,
    deletedAt: null as Date | null,
    wellhubClassId: null as string | null,
    wellhubSlotId: null as string | null,
    instructor: { name: "Coach Wave" },
  };
  let booked = 12;

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
    class: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...cls })),
      update: vi.fn().mockImplementation(async ({ data }) => {
        Object.assign(cls, data);
        return { ...cls };
      }),
    },
    booking: {
      aggregate: vi.fn().mockImplementation(async () => ({
        _sum: { quantity: booked },
      })),
    },
  };
  const db = {
    $transaction: vi.fn().mockImplementation(async (callback) => callback(tx)),
  };
  const client: WellhubBookingClient = {
    listCategoryIds: vi.fn().mockResolvedValue(new Set([7, 8])),
    listClasses: vi.fn().mockResolvedValue([]),
    createClass: vi.fn().mockResolvedValue("8268"),
    updateClass: vi.fn().mockResolvedValue(undefined),
    listSlots: vi.fn().mockResolvedValue([]),
    createSlot: vi.fn().mockResolvedValue("9325"),
    updateSlot: vi.fn().mockResolvedValue(undefined),
    updateCapacity: vi.fn().mockResolvedValue(undefined),
    decideBooking: vi.fn().mockResolvedValue(undefined),
  };

  return {
    cls,
    db,
    tx,
    client,
    setBooked(value: number) {
      booked = value;
    },
  };
}

describe("Wellhub class/slot synchronization", () => {
  let subject: ReturnType<typeof harness>;

  beforeEach(() => {
    subject = harness();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not write sync metadata when production activation is forbidden", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "true");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const updateMany = vi.fn();

    await expect(
      syncWellhubClassSafely("wave_class_1", {
        db: { class: { updateMany } } as never,
      })
    ).resolves.toEqual({
      kind: "error",
      code: "WELLHUB_BOOKING_PRODUCTION_FORBIDDEN",
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("validates provider categories and creates a stable class and slot mapping", async () => {
    const result = await syncWellhubClass("wave_class_1", {
      db: subject.db as never,
      client: subject.client,
      config,
    });
    expect(result).toMatchObject({
      kind: "synced",
      wellhubClassId: "8268",
      wellhubSlotId: "9325",
      activeBookingCount: 12,
    });
    expect(subject.client.listCategoryIds).toHaveBeenCalledWith("es_MX");
    expect(subject.client.createClass).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "wave_class_1",
        categories: [7],
        product_id: 100003,
      })
    );
    expect(subject.client.createSlot).toHaveBeenCalledWith(
      "8268",
      expect.objectContaining({ total_capacity: 15, total_booked: 12 })
    );
    expect(subject.tx.booking.aggregate).toHaveBeenCalledWith({
      where: { classId: "wave_class_1", status: "ACTIVE" },
      _sum: { quantity: true },
    });
  });

  it("re-syncs by updating the same resources without duplicates", async () => {
    await syncWellhubClass("wave_class_1", {
      db: subject.db as never,
      client: subject.client,
      config,
    });
    subject.setBooked(13);
    await syncWellhubClass("wave_class_1", {
      db: subject.db as never,
      client: subject.client,
      config,
    });

    expect(subject.client.createClass).toHaveBeenCalledOnce();
    expect(subject.client.createSlot).toHaveBeenCalledOnce();
    expect(subject.client.updateClass).toHaveBeenCalledWith(
      "8268",
      expect.any(Object)
    );
    expect(subject.client.updateSlot).toHaveBeenCalledWith(
      "8268",
      "9325",
      expect.objectContaining({ total_booked: 13 })
    );
  });

  it("recovers an external class/slot created before a local mapping write", async () => {
    vi.mocked(subject.client.listClasses).mockResolvedValue([
      { id: "8268", reference: "wave_class_1" },
    ]);
    vi.mocked(subject.client.listSlots).mockResolvedValue([
      {
        id: "9325",
        classId: "8268",
        occurDate: subject.cls.date.toISOString(),
      },
    ]);
    await syncWellhubClass("wave_class_1", {
      db: subject.db as never,
      client: subject.client,
      config,
    });
    expect(subject.client.createClass).not.toHaveBeenCalled();
    expect(subject.client.createSlot).not.toHaveBeenCalled();
    expect(subject.cls).toMatchObject({
      wellhubClassId: "8268",
      wellhubSlotId: "9325",
    });
  });

  it("synchronizes WAVE cancellation as hidden/inactive", async () => {
    subject.cls.wellhubClassId = "8268";
    subject.cls.wellhubSlotId = "9325";
    subject.cls.isCanceled = true;
    await syncWellhubClass("wave_class_1", {
      db: subject.db as never,
      client: subject.client,
      config,
    });
    expect(subject.client.updateClass).toHaveBeenCalledWith(
      "8268",
      expect.objectContaining({ bookable: false, visible: false })
    );
    expect(subject.client.updateSlot).toHaveBeenCalledWith(
      "8268",
      "9325",
      expect.objectContaining({ status: 0 })
    );
  });

  it("refuses to publish capacity below authoritative active bookings", async () => {
    subject.cls.capacity = 10;
    subject.setBooked(11);
    await expect(
      syncWellhubClass("wave_class_1", {
        db: subject.db as never,
        client: subject.client,
        config,
      })
    ).rejects.toMatchObject({ code: "CAPACITY_BELOW_ACTIVE_BOOKINGS" });
  });

  it("rejects category IDs that are not in Wellhub's taxonomy", async () => {
    vi.mocked(subject.client.listCategoryIds).mockResolvedValue(new Set([8]));
    await expect(
      syncWellhubClass("wave_class_1", {
        db: subject.db as never,
        client: subject.client,
        config,
      })
    ).rejects.toMatchObject({ code: "UNKNOWN_WELLHUB_CATEGORY_ID" });
  });
});
