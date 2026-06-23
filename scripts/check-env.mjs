import fs from "node:fs";

const requiredServerEnvKeys = [
  "DATABASE_URL",
  "JWT_SECRET",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET",
  "CRON_SECRET",
];

function loadLocalEnvFile() {
  if (!process.cwd()) return;

  let text = "";
  try {
    text = fs.readFileSync(".env", "utf8");
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;

    const [, name, rawValue] = match;
    if (process.env[name]) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[name] = value;
  }
}

loadLocalEnvFile();

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
      appBaseUrl: redactedDatabaseTarget(process.env.APP_BASE_URL),
      database: redactedDatabaseTarget(process.env.DATABASE_URL),
    },
    null,
    2
  )
);

if (missing.length > 0) {
  process.exitCode = 1;
}
