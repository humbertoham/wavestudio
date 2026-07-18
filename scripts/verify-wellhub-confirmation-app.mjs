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
const planCaseIds = [];
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
  const userIds = [affectedId, unaffectedId, ...planCaseIds];
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
  const confirmedCookie = cookieFrom(confirmation);
  assert(
    (await request("/clases", { headers: { cookie: confirmedCookie } })).status ===
      200,
    "The first /clases request with the replacement cookie was blocked."
  );
  assert(
    (await request("/clases", { headers: { cookie: confirmedCookie } })).status ===
      200,
    "Refreshing /clases with the replacement cookie failed."
  );
  assert(
    (await request("/perfil", { headers: { cookie: confirmedCookie } })).status ===
      200,
    "Protected navigation with the replacement cookie failed."
  );
  assert(
    (await request("/perfil", { headers: { cookie: confirmationLogin.cookie } }))
      .status === 307,
    "The pre-confirmation JWT was not invalidated by the N to N+1 rotation."
  );

  // Simulate a committed database update whose Set-Cookie response was lost:
  // retry with the previous signed cookie and require transition-bound recovery.
  const recovered = await request(
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
  const recoveredPayload = await recovered.json();
  assert(
    recovered.status === 200 &&
      recoveredPayload.alreadyConfirmed === true &&
      recoveredPayload.sessionRecovered === true,
    "A lost confirmation-cookie response was not recovered safely."
  );
  const recoveredCookie = cookieFrom(recovered);
  assert(
    (await request("/clases", { headers: { cookie: recoveredCookie } })).status ===
      200,
    "Recovered session could not reach /clases."
  );

  const alreadyCurrent = await request(
    "/api/users/me/wellhub-plan-confirmation",
    {
      method: "POST",
      headers: {
        cookie: confirmedCookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wellhubPlan: "PLATINUM" }),
    }
  );
  const alreadyCurrentPayload = await alreadyCurrent.json();
  assert(
    alreadyCurrent.status === 200 &&
      alreadyCurrentPayload.alreadyConfirmed === true &&
      alreadyCurrentPayload.sessionRecovered === false,
    "Already-confirmed current session was not handled idempotently."
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
      user.wellhubPlanConfirmationRequired === false &&
      user.authVersion === 2,
    "Persisted plan/access state is incorrect."
  );
  assert(paidPack.classesLeft === 5, "Purchased credits were changed.");
  assert(
    audit.status === "COMPLETED" &&
      audit.creditDeltaApplied === 6 &&
      audit.authVersionBefore === 1 &&
      audit.authVersionAfter === 2 &&
      audit.sessionRecoveryExpiresAt instanceof Date,
    "Campaign audit is incomplete."
  );
  assert(ledgerCount === 1, "Confirmation ledger was duplicated.");
  assert(challengeCount === 0, "Unrelated Challenge state changed.");

  const planCredits = {
    GOLD_PLUS: 2,
    PLATINUM: 8,
    DIAMOND: 30,
    DIAMOND_PLUS: 30,
  };
  const verifiedPlans = [];
  for (const [selectedPlan, expectedCredits] of Object.entries(planCredits)) {
    const planUserId = `wellhub_plan_smoke_${selectedPlan.toLowerCase()}_${suffix}`;
    planCaseIds.push(planUserId);
    await prisma.user.create({
      data: {
        id: planUserId,
        name: `Disposable ${selectedPlan} smoke user`,
        email: `${planUserId}@example.invalid`,
        passwordHash,
        affiliation: "WELLHUB",
        wellhubPlan: "GOLD_PLUS",
        affiliationConfirmedAt: new Date(),
      },
    });
    await prisma.packPurchase.create({
      data: {
        userId: planUserId,
        packId: "corp_wellhub_gold_plus_monthly",
        classesLeft: 2,
        expiresAt,
      },
    });
    const planCampaign = `${campaign}-${selectedPlan.toLowerCase()}`;
    assert(
      (await runCampaignCli([
        `--target=${target}`,
        `--campaign=${planCampaign}`,
        `--user-id=${planUserId}`,
        "--apply",
      ])) === 0,
      `${selectedPlan} campaign setup failed.`
    );
    const planLogin = await login(`${planUserId}@example.invalid`);
    const submitPlan = () =>
      request("/api/users/me/wellhub-plan-confirmation", {
        method: "POST",
        headers: {
          cookie: planLogin.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ wellhubPlan: selectedPlan }),
      });
    const planResponses =
      selectedPlan === "DIAMOND"
        ? await Promise.all([submitPlan(), submitPlan()])
        : [await submitPlan()];
    const planPayloads = await Promise.all(
      planResponses.map((response) => response.json())
    );
    assert(
      planResponses.every((response) => response.status === 200),
      `${selectedPlan} confirmation failed.`
    );
    const confirmedIndex = planPayloads.findIndex(
      (payload) => payload.confirmation
    );
    assert(confirmedIndex >= 0, `${selectedPlan} had no committed response.`);
    const planResponse = planResponses[confirmedIndex];
    const planPayload = planPayloads[confirmedIndex];
    assert(
      planPayload.confirmation?.resultingBalance === expectedCredits,
      `${selectedPlan} resulting credits were incorrect.`
    );
    const planCookie = cookieFrom(planResponse);
    assert(
      (await request("/clases", { headers: { cookie: planCookie } })).status ===
        200,
      `${selectedPlan} replacement session could not reach /clases.`
    );
    const [planUser, planLedger] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: planUserId } }),
      prisma.tokenLedger.findMany({
        where: {
          userId: planUserId,
          reason: "USER_WELLHUB_PLAN_CONFIRMATION",
        },
      }),
    ]);
    assert(
      planUser.wellhubPlan === selectedPlan &&
        planUser.authVersion === 2 &&
        planLedger.length === 1,
      `${selectedPlan} persisted state or idempotency audit was incorrect.`
    );
    verifiedPlans.push(selectedPlan);
  }

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
        confirmationSessionRotation: "N-to-N+1",
        lostCookieResponseRecovery: "passed",
        alreadyConfirmedRecovery: "passed",
        firstAndRefreshedClassesRequest: "passed",
        pageAndApiBlocking: "passed",
        logoutAllowed: "passed",
        canonicalPlanCount: plansPayload.plans.length,
        creditDeltaApplied: 6,
        resultingBalance: 13,
        purchasedCreditsPreserved: 5,
        traceabilityRows: ledgerCount,
        sameCampaignRerun: "idempotent",
        challengeState: "unchanged",
        verifiedPlans,
        concurrentDiamondSubmissions: "idempotent",
      },
      null,
      2
    )
  );
} finally {
  await cleanup();
  await prisma.$disconnect();
}
