import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

import {
  main as runCampaignCli,
  resolveDatabaseTarget,
} from "./require-wellhub-plan-confirmation.mjs";

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, ...value] = raw.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  })
);
const target = String(args.get("target") ?? "");
const baseUrl = String(args.get("base-url") ?? "http://127.0.0.1:3200").replace(
  /\/$/,
  ""
);

if (target !== "dev" && target !== "uat") {
  console.error(
    "Usage: node scripts/verify-wellhub-confirmation-app.mjs --target=dev|uat [--base-url=http://127.0.0.1:3200]"
  );
  process.exit(1);
}

const config = resolveDatabaseTarget({ target });
const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
});
const suffix = crypto.randomUUID().replaceAll("-", "");
const affectedId = `wellhub_app_smoke_${suffix}`;
const unaffectedId = `none_app_smoke_${suffix}`;
const paidPackId = `paid_app_smoke_${suffix}`;
const campaign = `wellhub-plan-reconfirmation-2026-${target}-smoke-${Date.now()}`;
const password = `Smoke-${crypto.randomUUID()}-9a`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
}

function cookieFrom(response) {
  const header = response.headers.get("set-cookie") ?? "";
  const cookie = header.split(";", 1)[0];
  assert(cookie.startsWith("session="), "Login did not return a session cookie.");
  return cookie;
}

async function login(email) {
  const response = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert(response.status === 200, `Login failed with ${response.status}.`);
  return { response, cookie: cookieFrom(response) };
}

async function cleanup() {
  const userIds = [affectedId, unaffectedId];
  await prisma.tokenLedger.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.packPurchase.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wellhubPlanConfirmation.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.pack.deleteMany({ where: { id: paidPackId } });
}

try {
  await cleanup();
  const passwordHash = await hash(password, 10);
  const expiresAt = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)
  );

  await prisma.pack.upsert({
    where: { id: "corp_wellhub_gold_plus_monthly" },
    update: {},
    create: {
      id: "corp_wellhub_gold_plus_monthly",
      name: "WellHub Gold+ Mensual (Interno)",
      classes: 2,
      price: 0,
      validityDays: 31,
      isActive: false,
      isVisible: false,
      classesLabel: "2 clases",
    },
  });
  await prisma.pack.create({
    data: {
      id: paidPackId,
      name: "Disposable paid smoke pack",
      classes: 5,
      price: 500,
      validityDays: 30,
      isVisible: false,
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: affectedId,
        name: "Disposable WellHub smoke user",
        email: `${affectedId}@example.invalid`,
        passwordHash,
        affiliation: "WELLHUB",
        wellhubPlan: "GOLD_PLUS",
        affiliationConfirmedAt: new Date(),
      },
      {
        id: unaffectedId,
        name: "Disposable unaffected smoke user",
        email: `${unaffectedId}@example.invalid`,
        passwordHash,
        affiliation: "NONE",
        affiliationConfirmedAt: new Date(),
      },
    ],
  });
  await prisma.packPurchase.createMany({
    data: [
      {
        userId: affectedId,
        packId: "corp_wellhub_gold_plus_monthly",
        classesLeft: 2,
        expiresAt,
      },
      {
        userId: affectedId,
        packId: paidPackId,
        classesLeft: 5,
        expiresAt,
      },
    ],
  });

  const affectedBefore = await login(`${affectedId}@example.invalid`);
  assert(
    (await request("/clases", { headers: { cookie: affectedBefore.cookie } }))
      .status === 200,
    "Controlled WellHub user was blocked before campaign application."
  );
  const unaffected = await login(`${unaffectedId}@example.invalid`);
  assert(
    (await request("/perfil", { headers: { cookie: unaffected.cookie } }))
      .status === 200,
    "Unaffected non-WellHub user did not retain normal access."
  );

  const commandExit = await runCampaignCli([
    `--target=${target}`,
    `--campaign=${campaign}`,
    `--user-id=${affectedId}`,
    "--apply",
  ]);
  assert(commandExit === 0, "Controlled campaign command failed.");

  const oldPage = await request("/clases", {
    headers: { cookie: affectedBefore.cookie },
  });
  assert(
    oldPage.status === 307,
    `Old page session was not invalidated (status ${oldPage.status}, location ${oldPage.headers.get("location") ?? "none"}).`
  );
  assert(
    (oldPage.headers.get("location") ?? "").includes(
      "next=%2Factualizar-plan-wellhub"
    ),
    "Old session did not route through login to confirmation."
  );
  const oldApi = await request("/api/users/me/tokens", {
    headers: { cookie: affectedBefore.cookie },
  });
  assert(oldApi.status === 401, "Old API session remained usable.");

  const affectedAfter = await login(`${affectedId}@example.invalid`);
  const loginPayload = await affectedAfter.response.json();
  assert(
    loginPayload.wellhubPlanConfirmationRequired === true,
    "New login did not expose the required confirmation state."
  );
  for (const path of ["/clases", "/perfil", "/mis-clases", "/challenge"] ) {
    const response = await request(path, {
      headers: { cookie: affectedAfter.cookie },
    });
    assert(response.status === 307, `${path} was not blocked.`);
    const location = response.headers.get("location");
    assert(
      location &&
        new URL(location, baseUrl).pathname === "/actualizar-plan-wellhub",
      `${path} did not redirect to the confirmation page (location ${location ?? "none"}).`
    );
  }
  const protectedApi = await request("/api/bookings", {
    headers: { cookie: affectedAfter.cookie },
  });
  assert(protectedApi.status === 428, "Protected API did not return 428.");

  const confirmationPage = await request("/actualizar-plan-wellhub", {
    headers: { cookie: affectedAfter.cookie },
  });
  assert(confirmationPage.status === 200, "Confirmation page was inaccessible.");
  assert(
    (await confirmationPage.text()).includes("Actualiza tu plan de WellHub"),
    "Confirmation page did not render the Spanish title."
  );
  const plansResponse = await request("/api/wellhub/plans", {
    headers: { cookie: affectedAfter.cookie },
  });
  const plansPayload = await plansResponse.json();
  assert(
    plansResponse.status === 200 && plansPayload.plans?.length === 4,
    "Canonical plan API was unavailable or incomplete."
  );
  const logout = await request("/api/auth/logout", {
    method: "POST",
    headers: { cookie: affectedAfter.cookie },
  });
  assert(logout.status === 200, "Logout was not accessible while blocked.");

  const confirmationLogin = await login(`${affectedId}@example.invalid`);
  const confirmation = await request(
    "/api/users/me/wellhub-plan-confirmation",
    {
      method: "POST",
      headers: {
        cookie: confirmationLogin.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wellhubPlan: "PLATINUM" }),
    }
  );
  const confirmationPayload = await confirmation.json();
  assert(confirmation.status === 200, "Plan confirmation failed.");
  assert(
    confirmationPayload.confirmation?.creditDeltaApplied === 6 &&
      confirmationPayload.confirmation?.resultingBalance === 13,
    "Credit synchronization did not apply the expected one-time difference."
  );

  const duplicate = await request(
    "/api/users/me/wellhub-plan-confirmation",
    {
      method: "POST",
      headers: {
        cookie: confirmationLogin.cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wellhubPlan: "PLATINUM" }),
    }
  );
  assert(duplicate.status === 409, "Duplicate confirmation was not rejected.");
  assert(
    (await request("/perfil", { headers: { cookie: confirmationLogin.cookie } }))
      .status === 200,
    "Normal access was not restored immediately."
  );
  const relogin = await login(`${affectedId}@example.invalid`);
  assert(
    (await request("/clases", { headers: { cookie: relogin.cookie } })).status ===
      200,
    "The confirmation page reappeared after a fresh login."
  );

  const [user, paidPack, audit, ledgerCount, challengeCount] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: affectedId } }),
      prisma.packPurchase.findFirstOrThrow({
        where: { userId: affectedId, packId: paidPackId },
      }),
      prisma.wellhubPlanConfirmation.findUniqueOrThrow({
        where: { campaign_userId: { campaign, userId: affectedId } },
      }),
      prisma.tokenLedger.count({
        where: {
          userId: affectedId,
          reason: "USER_WELLHUB_PLAN_CONFIRMATION",
        },
      }),
      prisma.challengeUserTotal.count({ where: { userId: affectedId } }),
    ]);
  assert(
    user.wellhubPlan === "PLATINUM" &&
      user.wellhubPlanConfirmationRequired === false,
    "Persisted plan/access state is incorrect."
  );
  assert(paidPack.classesLeft === 5, "Purchased credits were changed.");
  assert(
    audit.status === "COMPLETED" && audit.creditDeltaApplied === 6,
    "Campaign audit is incomplete."
  );
  assert(ledgerCount === 1, "Confirmation ledger was duplicated.");
  assert(challengeCount === 0, "Unrelated Challenge state changed.");

  const rerunExit = await runCampaignCli([
    `--target=${target}`,
    `--campaign=${campaign}`,
    `--user-id=${affectedId}`,
    "--apply",
  ]);
  assert(rerunExit === 0, "Idempotent campaign rerun failed.");
  assert(
    (await prisma.user.findUniqueOrThrow({ where: { id: affectedId } }))
      .wellhubPlanConfirmationRequired === false,
    "Same-campaign rerun re-blocked the completed user."
  );

  console.log(
    JSON.stringify(
      {
        target: target.toUpperCase(),
        controlledAppVerification: "passed",
        unaffectedAccess: "passed",
        oldSessionInvalidation: "passed",
        pageAndApiBlocking: "passed",
        logoutAllowed: "passed",
        canonicalPlanCount: plansPayload.plans.length,
        creditDeltaApplied: 6,
        resultingBalance: 13,
        purchasedCreditsPreserved: 5,
        traceabilityRows: ledgerCount,
        sameCampaignRerun: "idempotent",
        challengeState: "unchanged",
      },
      null,
      2
    )
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
}
