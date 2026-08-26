import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processWellhubCheckin: vi.fn(),
  processWellhubBookingEvent: vi.fn(),
}));

vi.mock("@/lib/wellhub/checkin", () => ({
  processWellhubCheckin: mocks.processWellhubCheckin,
}));

vi.mock("@/lib/wellhub/booking/service", () => ({
  processWellhubBookingEvent: mocks.processWellhubBookingEvent,
}));

import { computeWellhubSignature } from "@/lib/wellhub/signature";
import { POST } from "./route";

const webhookSecret = "fake-wellhub-test-webhook-secret";
const validPayload = JSON.stringify({
  event_type: "checkin",
  event_data: {
    user: {
      unique_token: "1000000000003",
      first_name: "Patty",
      last_name: "Cork",
      email: "member@example.com",
    },
    location: { lat: 19.4326, lon: -99.1332 },
    gym: {
      id: 129,
      title: "WAVE Studio",
      product: { id: 2, description: "Sandbox" },
    },
    timestamp: 1786453200,
  },
});
const validBookingPayload = JSON.stringify({
  event_type: "booking-requested",
  event_data: {
    user: {
      unique_token: "1000000000003",
      name: "Patty Cork",
      email: "member@example.com",
    },
    slot: {
      id: 9325,
      gym_id: 129,
      class_id: 8268,
      booking_number: "BK_HEQYZMK",
    },
    timestamp: 1664461204015,
    event_id: "45b4b8a4-f2f3-4b33-adf0-504c33f27642",
  },
});

function request(rawBody: string, signature?: string) {
  return new Request(
    "http://localhost/api/integrations/wellhub/webhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "X-Gympass-Signature": signature } : {}),
      },
      body: rawBody,
    }
  );
}

function signedRequest(rawBody: string) {
  return request(rawBody, computeWellhubSignature(rawBody, webhookSecret));
}

describe("Wellhub webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("WELLHUB_CHECKIN_ENABLED", "true");
    vi.stubEnv(
      "WELLHUB_API_BASE_URL",
      "https://apitesting.partners.gympass.com/access/v1"
    );
    vi.stubEnv("WELLHUB_API_TOKEN", "fake-token");
    vi.stubEnv("WELLHUB_GYM_ID", "129");
    vi.stubEnv("WELLHUB_WEBHOOK_SECRET", webhookSecret);
    vi.stubEnv("WELLHUB_API_TIMEOUT_MS", "800");
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "false");
    mocks.processWellhubCheckin.mockReset();
    mocks.processWellhubCheckin.mockResolvedValue({
      kind: "authorized",
      checkinId: "checkin_1",
      matchedUserId: null,
      retried: false,
    });
    mocks.processWellhubBookingEvent.mockReset();
    mocks.processWellhubBookingEvent.mockResolvedValue({
      kind: "accepted",
      bookingId: "booking_1",
      classId: "class_1",
      matchedUserId: null,
      activeBookingCount: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("processes a signed check-in event", async () => {
    const response = await POST(signedRequest(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "AUTHORIZED" });
    expect(mocks.processWellhubCheckin).toHaveBeenCalledOnce();
  });

  it("rejects malformed payloads after signature verification", async () => {
    const raw = '{"event_type":"checkin","event_data":{}}';
    const response = await POST(signedRequest(raw));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_CHECKIN_EVENT" });
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("acknowledges unsupported future event types without processing them", async () => {
    const raw = JSON.stringify({ event_type: "future-event", event_data: {} });
    const response = await POST(signedRequest(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "UNSUPPORTED_EVENT",
    });
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate without a second validation", async () => {
    mocks.processWellhubCheckin.mockResolvedValue({
      kind: "duplicate",
      checkinId: "checkin_1",
      matchedUserId: null,
      status: "AUTHORIZED",
    });

    const response = await POST(signedRequest(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      duplicate: true,
      result: "AUTHORIZED",
    });
  });

  it("does not read or validate events while the feature flag is disabled", async () => {
    vi.stubEnv("WELLHUB_CHECKIN_ENABLED", "false");

    const response = await POST(request(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "DISABLED",
    });
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("acknowledges invalid operator configuration without triggering retries", async () => {
    vi.stubEnv("WELLHUB_API_TOKEN", "");

    const response = await POST(request(validPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "NOT_CONFIGURED",
    });
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("rejects a bad signature before any business operation", async () => {
    const response = await POST(request(validPayload, "A".repeat(40)));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_SIGNATURE" });
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("returns a temporary failure for a retryable Wellhub outage", async () => {
    mocks.processWellhubCheckin.mockResolvedValue({
      kind: "error",
      checkinId: "checkin_1",
      matchedUserId: null,
      code: "WELLHUB_TIMEOUT",
      retryable: true,
      retried: false,
    });

    const response = await POST(signedRequest(validPayload));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      result: "ERROR",
      retryable: true,
    });
  });

  it("routes a valid signed booking event when Booking is independently enabled", async () => {
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "true");
    vi.stubEnv(
      "WELLHUB_BOOKING_API_BASE_URL",
      "https://apitesting.partners.gympass.com/booking/v1"
    );
    vi.stubEnv("WELLHUB_BOOKING_PRODUCT_ID", "100003");
    vi.stubEnv("WELLHUB_BOOKING_SYNC_HORIZON_DAYS", "30");

    const response = await POST(signedRequest(validBookingPayload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "RESERVED" });
    expect(mocks.processWellhubBookingEvent).toHaveBeenCalledOnce();
    expect(mocks.processWellhubCheckin).not.toHaveBeenCalled();
  });

  it("requests a retry while a duplicate booking event is still processing", async () => {
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "true");
    vi.stubEnv(
      "WELLHUB_BOOKING_API_BASE_URL",
      "https://apitesting.partners.gympass.com/booking/v1"
    );
    vi.stubEnv("WELLHUB_BOOKING_PRODUCT_ID", "100003");
    mocks.processWellhubBookingEvent.mockResolvedValue({
      kind: "duplicate",
      status: "PROCESSING",
    });

    const response = await POST(signedRequest(validBookingPayload));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      result: "PROCESSING",
      retryable: true,
    });
  });

  it("rejects unsigned booking events before persistence or confirmation", async () => {
    vi.stubEnv("WELLHUB_BOOKING_ENABLED", "true");
    vi.stubEnv(
      "WELLHUB_BOOKING_API_BASE_URL",
      "https://apitesting.partners.gympass.com/booking/v1"
    );
    vi.stubEnv("WELLHUB_BOOKING_PRODUCT_ID", "100003");

    const response = await POST(request(validBookingPayload));
    expect(response.status).toBe(401);
    expect(mocks.processWellhubBookingEvent).not.toHaveBeenCalled();
  });

  it("acknowledges signed booking events without mutation when Booking is disabled", async () => {
    const response = await POST(signedRequest(validBookingPayload));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: "BOOKING_DISABLED",
    });
    expect(mocks.processWellhubBookingEvent).not.toHaveBeenCalled();
  });
});
