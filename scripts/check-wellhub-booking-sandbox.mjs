const SANDBOX_BASE = "https://apitesting.partners.gympass.com/booking/v1";

function present(name) {
  return Boolean(process.env[name]?.trim());
}

function positiveInteger(name) {
  const raw = process.env[name]?.trim();
  return Boolean(raw && /^\d+$/.test(raw) && Number(raw) > 0);
}

const production =
  process.env.VERCEL_ENV?.trim().toLowerCase() === "production" ||
  process.env.APP_ENV?.trim().toLowerCase() === "production";
const enabled =
  process.env.WELLHUB_BOOKING_ENABLED?.trim().toLowerCase() === "true";
const checks = {
  enabled,
  nonProductionContext: !production,
  sandboxBase:
    process.env.WELLHUB_BOOKING_API_BASE_URL?.trim() === SANDBOX_BASE,
  apiTokenPresent: present("WELLHUB_API_TOKEN"),
  webhookSecretPresent: present("WELLHUB_WEBHOOK_SECRET"),
  gymIdValid: positiveInteger("WELLHUB_GYM_ID"),
  productIdValid: positiveInteger("WELLHUB_BOOKING_PRODUCT_ID"),
  horizonValid: (() => {
    const value = Number(
      process.env.WELLHUB_BOOKING_SYNC_HORIZON_DAYS?.trim() || "30"
    );
    return Number.isInteger(value) && value >= 1 && value <= 90;
  })(),
};
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ ok, externalRequestSent: false, checks }, null, 2));
if (!ok) process.exitCode = 1;
