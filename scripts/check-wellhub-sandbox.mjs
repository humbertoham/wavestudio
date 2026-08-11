import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SANDBOX_HOST = "apitesting.partners.gympass.com";
const ACCESS_API_PATH = "/access/v1";
const DEFAULT_TIMEOUT_MS = 800;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 900;

const requiredWhenEnabled = [
  "WELLHUB_API_BASE_URL",
  "WELLHUB_API_TOKEN",
  "WELLHUB_GYM_ID",
  "WELLHUB_WEBHOOK_SECRET",
];

function hasValue(name) {
  return Boolean(process.env[name]?.trim());
}

function isOfficialSandboxTarget(raw) {
  if (!raw?.trim()) return false;

  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return (
      url.protocol === "https:" &&
      url.hostname === SANDBOX_HOST &&
      path === ACCESS_API_PATH &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isTimeoutValid(raw) {
  if (!raw?.trim()) return true;
  const value = Number(raw);
  return (
    Number.isInteger(value) &&
    value >= MIN_TIMEOUT_MS &&
    value <= MAX_TIMEOUT_MS
  );
}

const flag = process.env.WELLHUB_CHECKIN_ENABLED?.trim().toLowerCase();
const featureEnabled = flag === "true";
const requiredVariables = Object.fromEntries(
  requiredWhenEnabled.map((name) => [name, hasValue(name)])
);
const productionContext =
  process.env.VERCEL_ENV?.trim().toLowerCase() === "production" ||
  process.env.APP_ENV?.trim().toLowerCase() === "production";
const webhookRoutePresent = existsSync(
  fileURLToPath(
    new URL(
      "../src/app/api/integrations/wellhub/webhook/route.ts",
      import.meta.url
    )
  )
);

const checks = {
  featureEnabled,
  nonProductionContext: !productionContext,
  requiredVariables,
  officialSandboxApiTarget: isOfficialSandboxTarget(
    process.env.WELLHUB_API_BASE_URL
  ),
  gymIdFormatValid: /^\d{1,20}$/.test(process.env.WELLHUB_GYM_ID?.trim() ?? ""),
  timeout: {
    configured: hasValue("WELLHUB_API_TIMEOUT_MS"),
    valid: isTimeoutValid(process.env.WELLHUB_API_TIMEOUT_MS),
    defaultUsedWhenMissing: DEFAULT_TIMEOUT_MS,
  },
  webhookRoutePresent,
};

const ok =
  checks.featureEnabled &&
  checks.nonProductionContext &&
  Object.values(checks.requiredVariables).every(Boolean) &&
  checks.officialSandboxApiTarget &&
  checks.gymIdFormatValid &&
  checks.timeout.valid &&
  checks.webhookRoutePresent;

console.log(
  JSON.stringify(
    {
      ok,
      externalRequestSent: false,
      checks,
    },
    null,
    2
  )
);

if (!ok) process.exitCode = 1;
