import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/check-wellhub-booking-sandbox.mjs");

const validEnvironment: Record<string, string> = {
  NODE_ENV: "test",
  APP_ENV: "development",
  VERCEL_ENV: "preview",
  WELLHUB_BOOKING_ENABLED: "true",
  WELLHUB_BOOKING_API_BASE_URL:
    "https://apitesting.partners.gympass.com/booking/v1",
  WELLHUB_API_TOKEN: "fake-preflight-token",
  WELLHUB_GYM_ID: "129",
  WELLHUB_WEBHOOK_SECRET: "fake-preflight-secret",
  WELLHUB_API_TIMEOUT_MS: "800",
  WELLHUB_BOOKING_PRODUCT_ID: "1139",
  WELLHUB_BOOKING_SYNC_HORIZON_DAYS: "30",
};

function run(overrides: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...validEnvironment, ...overrides } as NodeJS.ProcessEnv,
  });
}

describe("Wellhub Booking sandbox preflight", () => {
  it("passes without categories or external requests", () => {
    const result = run();
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toMatchObject({
      ok: true,
      externalRequestSent: false,
      checks: {
        categoriesNotRequired: true,
        webhookRouteExists: true,
      },
    });
    expect(result.stdout).not.toContain("fake-preflight-token");
    expect(result.stdout).not.toContain("fake-preflight-secret");
  });

  it("ignores an obsolete legacy category setting", () => {
    const result = run({
      WELLHUB_BOOKING_CATEGORY_IDS: "obsolete-and-not-an-id",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true });
  });

  it("refuses production context", () => {
    const result = run({ VERCEL_ENV: "production" });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: { nonProductionContext: false },
    });
  });
});
