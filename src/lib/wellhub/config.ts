const SANDBOX_HOST = "apitesting.partners.gympass.com";
const PRODUCTION_HOST = "api.partners.gympass.com";
const ACCESS_API_PATH = "/access/v1";
const BOOKING_API_PATH = "/booking/v1";
const DEFAULT_TIMEOUT_MS = 800;
const MAX_TIMEOUT_MS = 900;
const DEFAULT_SYNC_HORIZON_DAYS = 30;

export class WellhubConfigError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "WellhubConfigError";
  }
}

export type WellhubConfig =
  | { enabled: false }
  | {
      enabled: true;
      apiBaseUrl: string;
      apiToken: string;
      gymId: string;
      webhookSecret: string;
      timeoutMs: number;
    };

export type WellhubBookingConfig =
  | { enabled: false }
  | {
      enabled: true;
      apiBaseUrl: string;
      apiToken: string;
      gymId: string;
      productId: number;
      categoryIds: number[];
      webhookSecret: string;
      timeoutMs: number;
      syncHorizonDays: number;
    };

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) {
    throw new WellhubConfigError(`MISSING_${name}`);
  }
  return value;
}

function readEnabled(env: NodeJS.ProcessEnv, name: string) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new WellhubConfigError(`INVALID_${name}`);
}

function isProductionDeployment(env: NodeJS.ProcessEnv) {
  return (
    env.VERCEL_ENV?.trim().toLowerCase() === "production" ||
    env.APP_ENV?.trim().toLowerCase() === "production"
  );
}

function readApiBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = required(env, "WELLHUB_API_BASE_URL");
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new WellhubConfigError("INVALID_WELLHUB_API_BASE_URL");
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const production = isProductionDeployment(env);
  const expectedHost = production ? PRODUCTION_HOST : SANDBOX_HOST;

  if (
    url.protocol !== "https:" ||
    url.hostname !== expectedHost ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    path !== ACCESS_API_PATH
  ) {
    throw new WellhubConfigError("INVALID_WELLHUB_API_BASE_URL");
  }

  return `${url.origin}${ACCESS_API_PATH}`;
}

function readBookingApiBaseUrl(env: NodeJS.ProcessEnv) {
  const raw = required(env, "WELLHUB_BOOKING_API_BASE_URL");
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new WellhubConfigError("INVALID_WELLHUB_BOOKING_API_BASE_URL");
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (
    url.protocol !== "https:" ||
    url.hostname !== SANDBOX_HOST ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    path !== BOOKING_API_PATH
  ) {
    throw new WellhubConfigError("INVALID_WELLHUB_BOOKING_API_BASE_URL");
  }

  return `${url.origin}${BOOKING_API_PATH}`;
}

function readTimeout(env: NodeJS.ProcessEnv) {
  const raw = env.WELLHUB_API_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 100 || value > MAX_TIMEOUT_MS) {
    throw new WellhubConfigError("INVALID_WELLHUB_API_TIMEOUT_MS");
  }

  return value;
}

export function getWellhubConfig(
  env: NodeJS.ProcessEnv = process.env
): WellhubConfig {
  if (!readEnabled(env, "WELLHUB_CHECKIN_ENABLED")) return { enabled: false };

  const gymId = required(env, "WELLHUB_GYM_ID");
  if (!/^\d{1,20}$/.test(gymId)) {
    throw new WellhubConfigError("INVALID_WELLHUB_GYM_ID");
  }

  return {
    enabled: true,
    apiBaseUrl: readApiBaseUrl(env),
    apiToken: required(env, "WELLHUB_API_TOKEN"),
    gymId,
    webhookSecret: required(env, "WELLHUB_WEBHOOK_SECRET"),
    timeoutMs: readTimeout(env),
  };
}

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  options: { required?: boolean; fallback?: number; max?: number } = {}
) {
  const raw = env[name]?.trim();
  if (!raw) {
    if (options.required) throw new WellhubConfigError(`MISSING_${name}`);
    return options.fallback;
  }

  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (options.max != null && value > options.max)
  ) {
    throw new WellhubConfigError(`INVALID_${name}`);
  }
  return value;
}

function readCategoryIds(env: NodeJS.ProcessEnv) {
  const raw = env.WELLHUB_BOOKING_CATEGORY_IDS?.trim();
  if (!raw) return [];

  const values = raw.split(",").map((part) => part.trim());
  if (values.length > 20 || values.some((value) => !/^\d{1,10}$/.test(value))) {
    throw new WellhubConfigError("INVALID_WELLHUB_BOOKING_CATEGORY_IDS");
  }

  const ids = [...new Set(values.map(Number))];
  if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new WellhubConfigError("INVALID_WELLHUB_BOOKING_CATEGORY_IDS");
  }
  return ids;
}

/**
 * Booking remains hard-disabled in production for this DEV-only phase. The
 * sandbox host/path allowlist also prevents an environment value from turning
 * the client into an SSRF primitive.
 */
export function getWellhubBookingConfig(
  env: NodeJS.ProcessEnv = process.env
): WellhubBookingConfig {
  if (!readEnabled(env, "WELLHUB_BOOKING_ENABLED")) return { enabled: false };
  if (isProductionDeployment(env)) {
    throw new WellhubConfigError("WELLHUB_BOOKING_PRODUCTION_FORBIDDEN");
  }

  const gymId = required(env, "WELLHUB_GYM_ID");
  if (!/^\d{1,20}$/.test(gymId)) {
    throw new WellhubConfigError("INVALID_WELLHUB_GYM_ID");
  }

  return {
    enabled: true,
    apiBaseUrl: readBookingApiBaseUrl(env),
    apiToken: required(env, "WELLHUB_API_TOKEN"),
    gymId,
    productId: readPositiveInteger(env, "WELLHUB_BOOKING_PRODUCT_ID", {
      required: true,
    })!,
    categoryIds: readCategoryIds(env),
    webhookSecret: required(env, "WELLHUB_WEBHOOK_SECRET"),
    timeoutMs: readTimeout(env),
    syncHorizonDays: readPositiveInteger(
      env,
      "WELLHUB_BOOKING_SYNC_HORIZON_DAYS",
      { fallback: DEFAULT_SYNC_HORIZON_DAYS, max: 90 }
    )!,
  };
}

export function getWellhubFeatureFlags(env: NodeJS.ProcessEnv = process.env) {
  return {
    checkin: readEnabled(env, "WELLHUB_CHECKIN_ENABLED"),
    booking: readEnabled(env, "WELLHUB_BOOKING_ENABLED"),
  };
}
