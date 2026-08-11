const SANDBOX_HOST = "apitesting.partners.gympass.com";
const PRODUCTION_HOST = "api.partners.gympass.com";
const ACCESS_API_PATH = "/access/v1";
const DEFAULT_TIMEOUT_MS = 800;
const MAX_TIMEOUT_MS = 900;

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

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) {
    throw new WellhubConfigError(`MISSING_${name}`);
  }
  return value;
}

function readEnabled(env: NodeJS.ProcessEnv) {
  const raw = env.WELLHUB_CHECKIN_ENABLED?.trim().toLowerCase();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new WellhubConfigError("INVALID_WELLHUB_CHECKIN_ENABLED");
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
  if (!readEnabled(env)) return { enabled: false };

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
