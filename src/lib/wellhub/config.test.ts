import { describe, expect, it } from "vitest";

import {
  getWellhubBookingConfig,
  getWellhubConfig,
  WellhubConfigError,
} from "@/lib/wellhub/config";

const sandboxEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  APP_ENV: "development",
  WELLHUB_CHECKIN_ENABLED: "true",
  WELLHUB_API_BASE_URL: "https://apitesting.partners.gympass.com/access/v1",
  WELLHUB_API_TOKEN: "fake-token",
  WELLHUB_GYM_ID: "129",
  WELLHUB_WEBHOOK_SECRET: "fake-secret",
  WELLHUB_API_TIMEOUT_MS: "800",
};

const bookingEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  APP_ENV: "development",
  WELLHUB_BOOKING_ENABLED: "true",
  WELLHUB_BOOKING_API_BASE_URL:
    "https://apitesting.partners.gympass.com/booking/v1",
  WELLHUB_API_TOKEN: "fake-token",
  WELLHUB_GYM_ID: "129",
  WELLHUB_WEBHOOK_SECRET: "fake-secret",
  WELLHUB_BOOKING_PRODUCT_ID: "100003",
  WELLHUB_BOOKING_CATEGORY_IDS: "7,8,7",
  WELLHUB_BOOKING_SYNC_HORIZON_DAYS: "30",
};

describe("Wellhub configuration", () => {
  it("defaults the integration to disabled", () => {
    expect(getWellhubConfig({ NODE_ENV: "test" })).toEqual({ enabled: false });
  });

  it("loads an explicitly enabled sandbox configuration", () => {
    expect(getWellhubConfig(sandboxEnv)).toMatchObject({
      enabled: true,
      apiBaseUrl: "https://apitesting.partners.gympass.com/access/v1",
      gymId: "129",
      timeoutMs: 800,
    });
  });

  it("rejects arbitrary hosts to prevent SSRF", () => {
    expect(() =>
      getWellhubConfig({
        ...sandboxEnv,
        WELLHUB_API_BASE_URL: "https://attacker.example/access/v1",
      })
    ).toThrowError(
      expect.objectContaining<Partial<WellhubConfigError>>({
        code: "INVALID_WELLHUB_API_BASE_URL",
      })
    );
  });

  it("rejects a production API host in development", () => {
    expect(() =>
      getWellhubConfig({
        ...sandboxEnv,
        WELLHUB_API_BASE_URL: "https://api.partners.gympass.com/access/v1",
      })
    ).toThrowError(WellhubConfigError);
  });

  it("keeps the timeout below the documented webhook response window", () => {
    expect(() =>
      getWellhubConfig({
        ...sandboxEnv,
        WELLHUB_API_TIMEOUT_MS: "1000",
      })
    ).toThrowError(
      expect.objectContaining<Partial<WellhubConfigError>>({
        code: "INVALID_WELLHUB_API_TIMEOUT_MS",
      })
    );
  });
});

describe("Wellhub Booking configuration", () => {
  it("is independently disabled by default", () => {
    expect(getWellhubBookingConfig({ NODE_ENV: "test" })).toEqual({
      enabled: false,
    });
  });

  it("loads only the official sandbox host and normalizes category IDs", () => {
    expect(getWellhubBookingConfig(bookingEnv)).toMatchObject({
      enabled: true,
      gymId: "129",
      productId: 100003,
      categoryIds: [7, 8],
      syncHorizonDays: 30,
    });
  });

  it("hard-rejects production activation", () => {
    expect(() =>
      getWellhubBookingConfig({ ...bookingEnv, APP_ENV: "production" })
    ).toThrowError(
      expect.objectContaining<Partial<WellhubConfigError>>({
        code: "WELLHUB_BOOKING_PRODUCTION_FORBIDDEN",
      })
    );
  });

  it("rejects arbitrary Booking API hosts and invalid provider IDs", () => {
    expect(() =>
      getWellhubBookingConfig({
        ...bookingEnv,
        WELLHUB_BOOKING_API_BASE_URL: "https://attacker.example/booking/v1",
      })
    ).toThrowError(WellhubConfigError);
    expect(() =>
      getWellhubBookingConfig({
        ...bookingEnv,
        WELLHUB_BOOKING_CATEGORY_IDS: "7,not-an-id",
      })
    ).toThrowError(WellhubConfigError);
  });
});
