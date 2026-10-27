import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// No dotenv or application import: the selected harness creates its own labeled
// localhost-only PostgreSQL container and supplies synthetic credentials.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/DATABASE_URL|DIRECT_URL|^PG|NEON_|VERCEL_|WELLHUB_|MP_|UPSTASH_|RESEND_API_KEY|CRON_SECRET|JWT_SECRET|RUN_.*INTEGRATION|RUN_.*DB_TESTS/.test(key)) delete env[key];
}
const harness = existsSync("scripts/test-wellhub-production.mjs")
  ? "scripts/test-wellhub-production.mjs"
  : "scripts/test-monthly-production.mjs";
execFileSync(process.execPath, [resolve(harness), "--full", "--build"], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
