import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const branch = execFileSync("git", ["branch", "--show-current"], {
  encoding: "utf8",
}).trim();
if (branch !== "dev")
  throw new Error("This database test runner is restricted to the dev branch.");
const full = process.argv.includes("--full");
const container = `wave-monthly-dev-test-${randomUUID()}`;
const password = randomUUID();
let started = false;
const docker = (args) => {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(
      "Disposable test container operation failed. Check that Docker is running.",
    );
  }
};
const command = (args, env) => {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", `npx.cmd ${args}`], {
          env,
          stdio: "inherit",
        })
      : spawnSync("npx", args.split(" "), { env, stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw new Error("DEV validation command failed.");
};
try {
  docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--label",
    "wave.environment=dev-validation",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=wave_monthly_dev_validation",
    "--env",
    "POSTGRES_USER=wave_dev_test",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:16-alpine",
  ]);
  started = true;
  const state = JSON.parse(docker(["inspect", container]))[0];
  const binding = state.NetworkSettings.Ports["5432/tcp"][0];
  if (
    state.Config.Labels["wave.environment"] !== "dev-validation" ||
    binding.HostIp !== "127.0.0.1"
  )
    throw new Error("Unsafe disposable test database binding.");
  const url = `postgresql://wave_dev_test:${password}@127.0.0.1:${binding.HostPort}/wave_monthly_dev_validation`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /DATABASE_URL|DIRECT_URL|WELLHUB_|MP_|UPSTASH_|RESEND_API_KEY|CRON_SECRET|JWT_SECRET|RUN_.*INTEGRATION|RUN_.*DB_TESTS/.test(
        key,
      )
    )
      delete env[key];
  }
  Object.assign(env, {
    NODE_ENV: "test",
    APP_ENV: "development",
    DATABASE_URL: url,
    WAVE_DEV_TEST_DATABASE_URL: url,
    JWT_SECRET: "automated-local-test-signing-only",
    MP_ACCESS_TOKEN: "TEST-automated-provider-only",
    APP_BASE_URL: "https://dev.example.invalid",
    RESEND_API_KEY: "re_automated_fixture_only",
    CRON_SECRET: "automated-fixture-only",
    MP_WEBHOOK_SECRET: "automated-test-signing-key",
    WELLHUB_CHECKIN_ENABLED: "false",
    WELLHUB_BOOKING_ENABLED: "false",
  });
  if (full)
    Object.assign(env, {
      RUN_CHALLENGE_INTEGRATION: "1",
      RUN_CLASS_DELETION_INTEGRATION: "1",
      RUN_NEW_USER_INTEGRATION: "1",
      RUN_WELLHUB_CONFIRMATION_DB_TESTS: "1",
    });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker([
        "exec",
        container,
        "pg_isready",
        "-U",
        "wave_dev_test",
        "-d",
        "wave_monthly_dev_validation",
      ]);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready)
    throw new Error("Disposable DEV PostgreSQL did not become ready.");
  console.log(
    "Validating on disposable localhost DEV PostgreSQL; provider calls are mocked and no payment is charged.",
  );
  command("prisma migrate deploy", env);
  command(
    `vitest run ${full ? "" : "src/lib/monthly-unlimited.test.ts src/lib/monthly-unlimited.database.test.ts "}--fileParallelism=false --silent --reporter=dot`,
    env,
  );
} finally {
  if (started) {
    const state = JSON.parse(docker(["inspect", container]))[0];
    if (
      state.Name !== `/${container}` ||
      state.Config.Labels["wave.environment"] !== "dev-validation"
    )
      throw new Error("Refusing to stop an unverified test container.");
    docker(["stop", "--time", "1", container]);
  }
}
