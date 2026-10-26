import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/check-wellhub-sandbox.mjs");

const validEnvironment: Record<string, string> = {
  NODE_ENV: "test",
  APP_ENV: "development",
  VERCEL_ENV: "preview",
  WELLHUB_CHECKIN_ENABLED: "true",
  WELLHUB_API_BASE_URL:
    "https://apitesting.partners.gympass.com/access/v1",
  WELLHUB_API_TOKEN: "fake-preflight-token",
  WELLHUB_GYM_ID: "129",
  WELLHUB_WEBHOOK_SECRET: "fake-preflight-secret",
  WELLHUB_API_TIMEOUT_MS: "800",
};

function run(overrides: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...validEnvironment, ...overrides } as NodeJS.ProcessEnv,
  });
}

describe("Wellhub sandbox preflight", () => {
  it("passes a complete non-production sandbox configuration without making a request", () => {
    const result = run();
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toMatchObject({ ok: true, externalRequestSent: false });
    expect(result.stdout).not.toContain("fake-preflight-token");
    expect(result.stdout).not.toContain("fake-preflight-secret");
  });

  it("fails safely while the feature is disabled", () => {
    const result = run({ WELLHUB_CHECKIN_ENABLED: "false" });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: { featureEnabled: false },
    });
  });

  it("rejects an arbitrary API host", () => {
    const result = run({
      WELLHUB_API_BASE_URL: "https://attacker.example/access/v1",
    });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: { officialSandboxApiTarget: false },
    });
  });

  it("refuses to certify a production context for sandbox testing", () => {
    const result = run({ VERCEL_ENV: "production" });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      checks: { nonProductionContext: false },
    });
  });
});
