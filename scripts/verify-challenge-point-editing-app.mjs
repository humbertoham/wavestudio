import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

import { resolveDatabaseTarget } from "./require-wellhub-plan-confirmation.mjs";

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
    "Usage: node scripts/verify-challenge-point-editing-app.mjs --target=dev|uat [--base-url=http://127.0.0.1:3200]"
  );
  process.exit(1);
}

const config = resolveDatabaseTarget({ target });
const prisma = new PrismaClient({
  datasources: { db: { url: config.databaseUrl } },
});
const suffix = crypto.randomUUID().replaceAll("-", "");
const adminId = `challenge_app_admin_${suffix}`;
const coachId = `challenge_app_coach_${suffix}`;
const userId = `challenge_app_user_${suffix}`;
const fixtureIds = [adminId, coachId, userId];
const password = `Smoke-${crypto.randomUUID()}-9a`;
const challengeKey = "WAVE_CHALLENGE";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
}

function sessionCookie(response) {
  const cookie = (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
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
  return sessionCookie(response);
}

const originalChallenge = await prisma.challenge.findUnique({
  where: { key: challengeKey },
});
const originalTotals = originalChallenge
  ? await prisma.challengeUserTotal.findMany({
      where: { challengeId: originalChallenge.id },
      select: {
        challengeId: true,
        userId: true,
        points: true,
        updatedAt: true,
      },
    })
  : [];
const originalAwards = originalChallenge
  ? await prisma.challengeBookingAward.findMany({
      where: { challengeId: originalChallenge.id },
      select: { id: true, isAwarded: true, reversedAt: true },
    })
  : [];

async function restoreAndCleanup() {
  const currentChallenge = await prisma.challenge.findUnique({
    where: { key: challengeKey },
  });
  if (currentChallenge) {
    await prisma.challengePointAdjustment.deleteMany({
      where: {
        challengeId: currentChallenge.id,
        OR: [
          { userId: { in: fixtureIds } },
          { actorUserId: { in: fixtureIds } },
        ],
      },
    });
    await prisma.challengeUserTotal.deleteMany({
      where: { challengeId: currentChallenge.id, userId: { in: fixtureIds } },
    });
  }

  if (originalChallenge && currentChallenge) {
    for (const total of originalTotals) {
      await prisma.challengeUserTotal.updateMany({
        where: {
          challengeId: total.challengeId,
          userId: total.userId,
        },
        data: { points: total.points, updatedAt: total.updatedAt },
      });
    }
    for (const award of originalAwards) {
      await prisma.challengeBookingAward.updateMany({
        where: { id: award.id },
        data: {
          isAwarded: award.isAwarded,
          reversedAt: award.reversedAt,
        },
      });
    }
    await prisma.challenge.update({
      where: { id: originalChallenge.id },
      data: {
        name: originalChallenge.name,
        isActive: originalChallenge.isActive,
        activationVersion: originalChallenge.activationVersion,
        activatedAt: originalChallenge.activatedAt,
        deactivatedAt: originalChallenge.deactivatedAt,
        activatedById: originalChallenge.activatedById,
        deactivatedById: originalChallenge.deactivatedById,
        createdAt: originalChallenge.createdAt,
        updatedAt: originalChallenge.updatedAt,
      },
    });
  } else if (!originalChallenge && currentChallenge) {
    await prisma.challenge.delete({ where: { id: currentChallenge.id } });
  }

  await prisma.user.deleteMany({ where: { id: { in: fixtureIds } } });
}

try {
  await restoreAndCleanup();
  const passwordHash = await hash(password, 10);
  const affiliationConfirmedAt = new Date();
  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        name: "Disposable Challenge admin",
        email: `${adminId}@example.invalid`,
        passwordHash,
        role: "ADMIN",
        affiliationConfirmedAt,
      },
      {
        id: coachId,
        name: "Disposable Challenge coach",
        email: `${coachId}@example.invalid`,
        passwordHash,
        role: "COACH",
        affiliationConfirmedAt,
      },
      {
        id: userId,
        name: "Disposable Challenge user",
        email: `${userId}@example.invalid`,
        passwordHash,
        role: "USER",
        affiliationConfirmedAt,
      },
    ],
  });

  const [adminCookie, coachCookie, userCookie] = await Promise.all([
    login(`${adminId}@example.invalid`),
    login(`${coachId}@example.invalid`),
    login(`${userId}@example.invalid`),
  ]);
  const adminHeaders = {
    cookie: adminCookie,
    "Content-Type": "application/json",
  };

  const status = await request("/api/admin/challenge", {
    headers: { cookie: adminCookie },
  });
  const statusBody = await status.json();
  if (!statusBody.challenge?.active) {
    const activation = await request("/api/admin/challenge", {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    assert(activation.status === 200, "Could not activate Challenge fixture state.");
  }

  let leaderboard = await request(
    "/api/admin/challenge/leaderboard?page=1&pageSize=100",
    { headers: { cookie: adminCookie } }
  );
  let leaderboardBody = await leaderboard.json();
  const initial = leaderboardBody.items.find((item) => item.id === userId);
  assert(initial?.points === 0, "Fixture did not start at zero points.");

  const update = await request(
    `/api/admin/challenge/users/${userId}/points`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        points: 25,
        expectedPoints: initial.points,
        expectedUpdatedAt: initial.updatedAt,
      }),
    }
  );
  const updateBody = await update.json();
  assert(update.status === 200 && updateBody.item?.points === 25, "Admin point update failed.");

  leaderboard = await request(
    "/api/admin/challenge/leaderboard?page=1&pageSize=100",
    { headers: { cookie: adminCookie } }
  );
  leaderboardBody = await leaderboard.json();
  const current = leaderboardBody.items.find((item) => item.id === userId);
  assert(current?.points === 25, "Leaderboard did not show the saved value.");

  const invalid = await request(
    `/api/admin/challenge/users/${userId}/points`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        points: 1.5,
        expectedPoints: current.points,
        expectedUpdatedAt: current.updatedAt,
      }),
    }
  );
  assert(invalid.status === 400, "Decimal points were not rejected.");

  for (const cookie of [coachCookie, userCookie]) {
    const forbidden = await request(
      `/api/admin/challenge/users/${userId}/points`,
      {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          points: 2,
          expectedPoints: current.points,
          expectedUpdatedAt: current.updatedAt,
        }),
      }
    );
    assert(forbidden.status === 403, "A non-admin could edit Challenge points.");
  }

  const stale = await request(
    `/api/admin/challenge/users/${userId}/points`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        points: 30,
        expectedPoints: initial.points,
        expectedUpdatedAt: initial.updatedAt,
      }),
    }
  );
  assert(stale.status === 409, "Stale Challenge update did not conflict.");

  const zero = await request(
    `/api/admin/challenge/users/${userId}/points`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({
        points: 0,
        expectedPoints: current.points,
        expectedUpdatedAt: current.updatedAt,
      }),
    }
  );
  assert(zero.status === 200, "Setting Challenge points to zero failed.");

  const audits = await prisma.challengePointAdjustment.findMany({
    where: { userId, actorUserId: adminId },
    orderBy: { createdAt: "asc" },
  });
  assert(
    audits.length === 2 &&
      audits[0].previousPoints === 0 &&
      audits[0].newPoints === 25 &&
      audits[1].previousPoints === 25 &&
      audits[1].newPoints === 0,
    "Admin adjustment audit was incomplete."
  );

  const deactivation = await request("/api/admin/challenge", {
    method: "DELETE",
    headers: { cookie: adminCookie },
  });
  assert(deactivation.status === 200, "Challenge deactivation reset failed.");
  const reactivation = await request("/api/admin/challenge", {
    method: "POST",
    headers: { cookie: adminCookie },
  });
  assert(reactivation.status === 200, "Challenge activation reset failed.");
  const resetTotal = await prisma.challengeUserTotal.findUniqueOrThrow({
    where: {
      challengeId_userId: {
        challengeId: audits[0].challengeId,
        userId,
      },
    },
  });
  assert(resetTotal.points === 0, "Lifecycle reset retained a manual point value.");

  console.log(
    JSON.stringify(
      {
        target: target.toUpperCase(),
        controlledChallengeVerification: "passed",
        adminEdit: "passed",
        zeroValue: "passed",
        invalidValue: "rejected",
        coachAndUserAuthorization: "forbidden",
        staleWrite: "conflict",
        leaderboardRefresh: "passed",
        auditRows: audits.length,
        lifecycleReset: "passed",
      },
      null,
      2
    )
  );
} finally {
  await restoreAndCleanup();
  await prisma.$disconnect();
}
