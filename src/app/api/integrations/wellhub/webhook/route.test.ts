import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processWellhubCheckin: vi.fn(),
}));

vi.mock("@/lib/wellhub/checkin", () => ({
  processWellhubCheckin: mocks.processWellhubCheckin,
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
    mocks.processWellhubCheckin.mockReset();
    mocks.processWellhubCheckin.mockResolvedValue({
      kind: "authorized",
      checkinId: "checkin_1",
      matchedUserId: null,
      retried: false,
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
    const raw = JSON.stringify({ event_type: "booking-requested", event_data: {} });
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

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "WELLHUB_CHECKIN_DISABLED",
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
});
