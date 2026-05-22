export const requiredServerEnvKeys = [
  "DATABASE_URL",
  "JWT_SECRET",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
  "CRON_SECRET",
] as const;

export const optionalServerEnvKeys = [
  "DIRECT_URL",
  "DATABASE_URL_UNPOOLED",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "ALLOW_SANDBOX",
  "CLEAN_NEXT_FULL",
] as const;

export type RequiredServerEnvKey = (typeof requiredServerEnvKeys)[number];
export type OptionalServerEnvKey = (typeof optionalServerEnvKeys)[number];
export type ServerEnvKey = RequiredServerEnvKey | OptionalServerEnvKey;

export function getOptionalServerEnv(name: ServerEnvKey) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getRequiredServerEnv(name: RequiredServerEnvKey) {
  const value = getOptionalServerEnv(name);
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

export function getRequiredServerEnvStatus() {
  return requiredServerEnvKeys.map((name) => ({
    name,
    present: Boolean(getOptionalServerEnv(name)),
  }));
}
