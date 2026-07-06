import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [, , target, action] = process.argv;
const allowedTargets = new Set(["dev", "uat"]);
const allowedActions = new Set(["status", "migrate"]);

if (!allowedTargets.has(target) || !allowedActions.has(action)) {
  console.error("Usage: node scripts/branch-db.mjs <dev|uat> <status|migrate>");
  process.exit(1);
}

const upperTarget = target.toUpperCase();
const envFile = `.env.${target}.local`;
const databaseKey = `DATABASE_URL_${upperTarget}_BRANCH`;
const directKey = `DIRECT_URL_${upperTarget}_BRANCH`;

if (!existsSync(envFile)) {
  console.error(
    `${envFile} is missing. Create it locally with ${databaseKey}; do not commit real credentials.`
  );
  process.exit(1);
}

function parseEnvFile(filePath) {
  const env = {};

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

function redactSecrets(value) {
  return value.replace(
    /postgres(?:ql)?:\/\/[^\s"']+/gi,
    "<redacted-database-url>"
  );
}

const fileEnv = parseEnvFile(envFile);
const databaseUrl = fileEnv[databaseKey]?.trim();

if (!databaseUrl) {
  console.error(`${envFile} must define ${databaseKey}.`);
  process.exit(1);
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const prismaArgs =
  action === "status"
    ? ["prisma", "migrate", "status"]
    : ["prisma", "migrate", "deploy"];

console.log(
  `Running prisma migrate ${action === "status" ? "status" : "deploy"} for ${target.toUpperCase()} using ${envFile}.`
);

const result = spawnSync(command, prismaArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  env: {
    ...process.env,
    ...fileEnv,
    DATABASE_URL: databaseUrl,
    ...(fileEnv[directKey]?.trim() ? { DIRECT_URL: fileEnv[directKey].trim() } : {}),
  },
});

if (result.stdout) process.stdout.write(redactSecrets(result.stdout));
if (result.stderr) process.stderr.write(redactSecrets(result.stderr));

process.exit(result.status ?? 1);
