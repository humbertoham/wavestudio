const requiredServerEnvKeys = [
  "DATABASE_URL",
  "JWT_SECRET",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
  "CRON_SECRET",
];

function hasValue(name) {
  return Boolean(process.env[name]?.trim());
}

function redactedDatabaseTarget(raw) {
  if (!raw?.trim()) {
    return { present: false, host: null, database: null };
  }

  try {
    const url = new URL(raw);
    const database = url.pathname.replace(/^\/+/, "") || null;
    return {
      present: true,
      host: url.hostname || null,
      database,
    };
  } catch {
    return {
      present: true,
      host: "<invalid-url>",
      database: "<invalid-url>",
    };
  }
}

const required = Object.fromEntries(
  requiredServerEnvKeys.map((name) => [name, hasValue(name)])
);
const missing = requiredServerEnvKeys.filter((name) => !required[name]);

console.log(
  JSON.stringify(
    {
      environment:
        process.env.VERCEL_ENV || process.env.APP_ENV || process.env.NODE_ENV || "local",
      NODE_ENV: process.env.NODE_ENV || null,
      required,
      database: redactedDatabaseTarget(process.env.DATABASE_URL),
    },
    null,
    2
  )
);

if (missing.length > 0) {
  process.exitCode = 1;
}
