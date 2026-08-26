import { describe, expect, it, vi } from "vitest";

import { createWellhubBookingClient } from "@/lib/wellhub/booking/client";
import type { WellhubBookingConfig } from "@/lib/wellhub/config";

const config = {
  enabled: true,
  apiBaseUrl: "https://apitesting.partners.gympass.com/booking/v1",
  apiToken: "secret-test-token",
  gymId: "129",
  productId: 100003,
  categoryIds: [],
  webhookSecret: "secret",
  timeoutMs: 800,
  syncHorizonDays: 30,
} satisfies WellhubBookingConfig;

function response(body: unknown, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), { status });
}

describe("Wellhub Booking API client", () => {
  it("lists provider-owned category IDs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({ results: [{ id: 7 }, { id: 8, name: "Pilates" }] })
    );
    const client = createWellhubBookingClient(config, { fetchImpl });
    expect(await client.listCategoryIds()).toEqual(new Set([7, 8]));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://apitesting.partners.gympass.com/booking/v1/gyms/129/categories?locale=es_MX",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("creates and updates a class with Bearer auth", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ classes: [{ id: 8268 }] }, 201))
      .mockResolvedValueOnce(response(null, 204));
    const client = createWellhubBookingClient(config, { fetchImpl });
    const payload = {
      name: "Pilates",
      description: "Core",
      bookable: true,
      visible: true,
      reference: "wave_1",
      product_id: 100003,
    };
    expect(await client.createClass(payload)).toBe("8268");
    await client.updateClass("8268", payload);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer secret-test-token",
      }),
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/classes/8268");
  });

  it("creates, updates, and patches authoritative slot counts", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ results: [{ id: 9325 }] }, 201))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response(null, 204));
    const client = createWellhubBookingClient(config, { fetchImpl });
    const slot = {
      occur_date: "2026-09-01T18:00:00.000Z",
      status: 1 as const,
      length_in_minutes: 60,
      total_capacity: 15,
      total_booked: 12,
      product_id: 100003,
      virtual: false as const,
    };
    expect(await client.createSlot("8268", slot)).toBe("9325");
    await client.updateSlot("8268", "9325", slot);
    await client.updateCapacity("8268", "9325", {
      total_capacity: 15,
      total_booked: 13,
    });
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "PUT",
      "PATCH",
    ]);
  });

  it("uses Booking v2 and official string statuses for decisions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, 204));
    const client = createWellhubBookingClient(config, { fetchImpl });
    await client.decideBooking("BK_HEQYZMK", { status: "RESERVED" });
    await client.decideBooking("BK_FULL", {
      status: "REJECTED",
      reason: "Class is full",
      reason_category: "CLASS_IS_FULL",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://apitesting.partners.gympass.com/booking/v2/gyms/129/bookings/BK_HEQYZMK"
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toContain("CLASS_IS_FULL");
  });

  it("sanitizes provider errors without exposing response bodies or tokens", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"secret":"provider detail"}', { status: 500 })
    );
    const client = createWellhubBookingClient(config, { fetchImpl });
    await expect(client.listClasses()).rejects.toMatchObject({
      code: "WELLHUB_BOOKING_HTTP_500",
      retryable: true,
    });
  });
});
