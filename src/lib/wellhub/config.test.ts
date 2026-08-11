import { describe, expect, it } from "vitest";

import {
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
