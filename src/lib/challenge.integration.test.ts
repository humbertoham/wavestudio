import { randomUUID } from "node:crypto";

import { Role, type Challenge } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const authState = vi.hoisted(() => ({ userId: "" }));

vi.mock("@/lib/auth", () => ({
  getAuthFromRequest: vi.fn(async () =>
    authState.userId ? { sub: authState.userId } : null
  ),
}));

import { GET as GET_LEADERBOARD } from "@/app/api/admin/challenge/leaderboard/route";
import {
  CHALLENGE_KEY,
  ChallengeError,
  activateChallenge,
  deactivateChallenge,
  getClassChallengeSnapshot,
  runChallengeTransaction,
  setClassChallengePoints,
  updateAttendanceWithChallenge,
} from "@/lib/challenge";
import { prisma } from "@/lib/prisma";

const describeWithDatabase =
  process.env.RUN_CHALLENGE_INTEGRATION === "1" ? describe : describe.skip;

if (process.env.RUN_CHALLENGE_INTEGRATION === "1") {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
}

describeWithDatabase("Challenge database integration", () => {
  let originalChallenge: Challenge | null;
  let originalTotals: Array<{
    challengeId: string;
    userId: string;
    points: number;
    updatedAt: Date;
  }> = [];
  let originalAwards: Array<{
    id: string;
    isAwarded: boolean;
    reversedAt: Date | null;
  }> = [];
  let adminId = "";
  let coachId = "";
  let userId = "";
  let secondUserId = "";
  let instructorId = "";
  const classIds = new Set<string>();
  const bookingIds = new Set<string>();

  beforeAll(async () => {
    await prisma.$connect();
    originalChallenge = await prisma.challenge.findUnique({
      where: { key: CHALLENGE_KEY },
    });
    if (originalChallenge) {
      [originalTotals, originalAwards] = await Promise.all([
        prisma.challengeUserTotal.findMany({
          where: { challengeId: originalChallenge.id },
          select: {
            challengeId: true,
            userId: true,
            points: true,
            updatedAt: true,
          },
        }),
        prisma.challengeBookingAward.findMany({
          where: { challengeId: originalChallenge.id },
          select: { id: true, isAwarded: true, reversedAt: true },
        }),
      ]);
    }
  });

  beforeEach(async () => {
    await prisma.challenge.updateMany({
      where: { key: CHALLENGE_KEY },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        activatedById: null,
        deactivatedById: null,
      },
    });

    const suffix = randomUUID();
    const [admin, coach, user, secondUser, instructor] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Challenge Admin",
          email: `challenge-admin-${suffix}@example.test`,
          passwordHash: "integration-test-only",
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Challenge Coach",
          email: `challenge-coach-${suffix}@example.test`,
          passwordHash: "integration-test-only",
          role: Role.COACH,
        },
      }),
      prisma.user.create({
        data: {
          name: "Ana Challenge",
          email: `challenge-user-${suffix}@example.test`,
          passwordHash: "integration-test-only",
        },
      }),
      prisma.user.create({
        data: {
          name: "Beto Challenge",
          email: `challenge-user-2-${suffix}@example.test`,
          passwordHash: "integration-test-only",
        },
      }),
      prisma.instructor.create({
        data: { name: `Challenge Instructor ${suffix}` },
      }),
    ]);

    adminId = admin.id;
    coachId = coach.id;
    userId = user.id;
    secondUserId = secondUser.id;
    instructorId = instructor.id;
    authState.userId = adminId;
  });

  afterEach(async () => {
    const users = [adminId, coachId, userId, secondUserId].filter(Boolean);
    const classes = [...classIds];
    const bookings = [...bookingIds];

    await prisma.challenge.updateMany({
      where: { key: CHALLENGE_KEY },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        activatedById: null,
        deactivatedById: null,
      },
    });
    await prisma.challengePointLedger.deleteMany({
      where: {
        OR: [
          { userId: { in: users } },
          { bookingId: { in: bookings } },
          { classId: { in: classes } },
        ],
      },
    });
    await prisma.challengeBookingAward.deleteMany({
      where: {
        OR: [
          { userId: { in: users } },
          { bookingId: { in: bookings } },
          { classId: { in: classes } },
        ],
      },
    });
    await prisma.challengeUserTotal.deleteMany({
      where: { userId: { in: users } },
    });
    await prisma.tokenLedger.deleteMany({ where: { userId: { in: users } } });
    await prisma.booking.deleteMany({
      where: { OR: [{ id: { in: bookings } }, { classId: { in: classes } }] },
    });
    await prisma.class.deleteMany({ where: { id: { in: classes } } });
    await prisma.packPurchase.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.instructor.deleteMany({ where: { id: instructorId } });

    classIds.clear();
    bookingIds.clear();
  });

  afterAll(async () => {
    if (originalChallenge) {
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
        where: { key: CHALLENGE_KEY },
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
    } else {
      await prisma.challenge.deleteMany({ where: { key: CHALLENGE_KEY } });
    }
    await prisma.$disconnect();
  });

  async function createClass(eligible: boolean, title = "Challenge class") {
    const cls = eligible
      ? await runChallengeTransaction(async (tx) =>
          tx.class.create({
            data: {
              title,
              focus: "Challenge",
              date: new Date(Date.now() + 86_400_000),
              durationMin: 60,
              capacity: 12,
              instructorId,
              ...(await getClassChallengeSnapshot(tx)),
            },
          })
        )
      : await prisma.class.create({
          data: {
            title,
            focus: "Challenge",
            date: new Date(Date.now() + 86_400_000),
            durationMin: 60,
            capacity: 12,
            instructorId,
          },
        });
    classIds.add(cls.id);
    return cls;
  }

  async function createBooking(classId: string, bookingUserId: string | null = userId) {
    const booking = await prisma.booking.create({
      data: {
        classId,
        userId: bookingUserId,
        guestName: bookingUserId ? null : "Invitado Challenge",
      },
    });
    bookingIds.add(booking.id);
    return booking;
  }

  it("persists lifecycle versions and snapshots eligibility only during active periods", async () => {
    const preexisting = await createClass(false, "Preexisting");
    const firstActivation = await activateChallenge(adminId);
    const eligible = await createClass(true, "Eligible period one");

    await expect(activateChallenge(adminId)).rejects.toMatchObject({
      code: "CHALLENGE_ALREADY_ACTIVE",
    });
    await deactivateChallenge(adminId);
    const paused = await runChallengeTransaction(async (tx) =>
      tx.class.create({
        data: {
          title: "Created while paused",
          focus: "Challenge",
          date: new Date(Date.now() + 86_400_000),
          durationMin: 60,
          capacity: 12,
          instructorId,
          ...(await getClassChallengeSnapshot(tx)),
        },
      })
    );
    classIds.add(paused.id);
    const reactivated = await activateChallenge(adminId);

    const [beforeRow, eligibleRow, pausedRow] = await Promise.all([
      prisma.class.findUniqueOrThrow({ where: { id: preexisting.id } }),
      prisma.class.findUniqueOrThrow({ where: { id: eligible.id } }),
      prisma.class.findUniqueOrThrow({ where: { id: paused.id } }),
    ]);

    expect(beforeRow.challengeId).toBeNull();
    expect(pausedRow.challengeId).toBeNull();
    expect(eligibleRow).toMatchObject({
      challengeId: firstActivation.id,
      challengePoints: 1,
      challengeActivationVersion: firstActivation.activationVersion,
    });
    expect(reactivated.id).toBe(firstActivation.id);
    expect(reactivated.activationVersion).toBe(firstActivation.activationVersion + 1);
  });

  it("serializes concurrent activation and keeps one active singleton", async () => {
    const results = await Promise.allSettled([
      activateChallenge(adminId),
      activateChallenge(adminId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.challenge.count({ where: { isActive: true } })
    ).toBe(1);
  });

  it("rolls the lifecycle state back when its point reset fails", async () => {
    const client = {
      $transaction: (
        callback: (tx: unknown) => Promise<unknown>,
        options: unknown
      ) =>
        prisma.$transaction(
          async (tx) =>
            callback(
              new Proxy(tx, {
                get(target, property, receiver) {
                  if (property === "challengeUserTotal") {
                    return {
                      updateMany: async () => {
                        throw new Error("forced lifecycle reset failure");
                      },
                    };
                  }
                  return Reflect.get(target, property, receiver);
                },
              })
            ),
          options as any
        ),
    };

    await expect(activateChallenge(adminId, client as any)).rejects.toThrow(
      "forced lifecycle reset failure"
    );
    await expect(
      prisma.challenge.findUniqueOrThrow({ where: { key: CHALLENGE_KEY } })
    ).resolves.toMatchObject({ isActive: false });
  });

  it("validates points, locks them after the first award, and never touches token records", async () => {
    await activateChallenge(adminId);
    const cls = await createClass(true);
    await expect(setClassChallengePoints(cls.id, 3)).resolves.toMatchObject({
      challengePoints: 3,
    });
    await expect(setClassChallengePoints(cls.id, 10)).resolves.toMatchObject({
      challengePoints: 10,
    });

    const booking = await createBooking(cls.id);
    const tokenBefore = await prisma.tokenLedger.count({ where: { userId } });
    await updateAttendanceWithChallenge({
      bookingId: booking.id,
      attended: true,
      actorUserId: coachId,
    });

    await expect(setClassChallengePoints(cls.id, 4)).rejects.toMatchObject({
      code: "CLASS_CHALLENGE_POINTS_LOCKED",
    });
    expect(await prisma.tokenLedger.count({ where: { userId } })).toBe(tokenBefore);
  });

  it("awards configured values once, reverses exactly, re-awards, and excludes guests/ineligible/cancelled/inactive attendance", async () => {
    const preexisting = await createClass(false, "Ineligible");
    await activateChallenge(adminId);
    const onePoint = await createClass(true, "One point");
    const threePoints = await createClass(true, "Three points");
    const tenPoints = await createClass(true, "Ten points");
    const cancelled = await createClass(true, "Cancelled");
    const inactiveAttendance = await createClass(true, "Inactive attendance");
    await setClassChallengePoints(threePoints.id, 3);
    await setClassChallengePoints(tenPoints.id, 10);
    await prisma.class.update({ where: { id: cancelled.id }, data: { isCanceled: true } });

    const [oneBooking, threeBooking, tenBooking, ineligibleBooking, cancelledBooking, inactiveBooking, guestBooking] =
      await Promise.all([
        createBooking(onePoint.id),
        createBooking(threePoints.id),
        createBooking(tenPoints.id),
        createBooking(preexisting.id),
        createBooking(cancelled.id),
        createBooking(inactiveAttendance.id),
        createBooking(onePoint.id, null),
      ]);

    const concurrent = await Promise.all([
      updateAttendanceWithChallenge({ bookingId: oneBooking.id, attended: true, actorUserId: coachId }),
      updateAttendanceWithChallenge({ bookingId: oneBooking.id, attended: true, actorUserId: coachId }),
    ]);
    expect(concurrent.map((result) => result.challenge.delta).sort()).toEqual([0, 1]);
    await updateAttendanceWithChallenge({ bookingId: threeBooking.id, attended: true, actorUserId: coachId });
    await updateAttendanceWithChallenge({ bookingId: tenBooking.id, attended: true, actorUserId: coachId });
    await updateAttendanceWithChallenge({ bookingId: ineligibleBooking.id, attended: true, actorUserId: coachId });
    await updateAttendanceWithChallenge({ bookingId: cancelledBooking.id, attended: true, actorUserId: coachId });
    await updateAttendanceWithChallenge({ bookingId: guestBooking.id, attended: true, actorUserId: coachId });

    let total = await prisma.challengeUserTotal.findFirstOrThrow({ where: { userId } });
    expect(total.points).toBe(14);

    const reversal = await updateAttendanceWithChallenge({
      bookingId: threeBooking.id,
      attended: false,
      actorUserId: coachId,
    });
    const duplicateReversal = await updateAttendanceWithChallenge({
      bookingId: threeBooking.id,
      attended: false,
      actorUserId: coachId,
    });
    expect(reversal.challenge.delta).toBe(-3);
    expect(duplicateReversal.challenge.delta).toBe(0);

    const reaward = await updateAttendanceWithChallenge({
      bookingId: threeBooking.id,
      attended: true,
      actorUserId: coachId,
    });
    expect(reaward.challenge.delta).toBe(3);

    await deactivateChallenge(adminId);
    const inactiveResult = await updateAttendanceWithChallenge({
      bookingId: inactiveBooking.id,
      attended: true,
      actorUserId: coachId,
    });
    expect(inactiveResult.challenge.delta).toBe(0);

    total = await prisma.challengeUserTotal.findFirstOrThrow({ where: { userId } });
    expect(total.points).toBe(0);
    const history = await prisma.challengePointLedger.findMany({
      where: { bookingId: threeBooking.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((entry) => [entry.reason, entry.delta, entry.cycle])).toEqual([
      ["ATTENDANCE_AWARD", 3, 1],
      ["ATTENDANCE_REVERSAL", -3, 1],
      ["ATTENDANCE_AWARD", 3, 2],
    ]);
  });

  it("resets current progress on both transitions while preserving history and credits", async () => {
    const challenge = await activateChallenge(adminId);
    const cls = await createClass(true, "Lifecycle reset class");
    await setClassChallengePoints(cls.id, 3);
    const booking = await createBooking(cls.id);
    await updateAttendanceWithChallenge({
      bookingId: booking.id,
      attended: true,
      actorUserId: coachId,
    });

    const [ledgerBefore, tokenLedgerBefore, userBefore] = await Promise.all([
      prisma.challengePointLedger.count({ where: { userId } }),
      prisma.tokenLedger.count({ where: { userId } }),
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { role: true, bookingBlocked: true },
      }),
    ]);

    await deactivateChallenge(adminId);
    await expect(
      prisma.challengeUserTotal.findUniqueOrThrow({
        where: { challengeId_userId: { challengeId: challenge.id, userId } },
      })
    ).resolves.toMatchObject({ points: 0 });
    await expect(
      prisma.challengeBookingAward.findUniqueOrThrow({
        where: {
          challengeId_bookingId: {
            challengeId: challenge.id,
            bookingId: booking.id,
          },
        },
      })
    ).resolves.toMatchObject({ isAwarded: false });

    // Seed non-zero mutable current state while paused to prove activation also
    // resets it. Immutable history remains untouched.
    await prisma.challengeUserTotal.update({
      where: { challengeId_userId: { challengeId: challenge.id, userId } },
      data: { points: 9 },
    });
    await prisma.challengeBookingAward.update({
      where: {
        challengeId_bookingId: {
          challengeId: challenge.id,
          bookingId: booking.id,
        },
      },
      data: { isAwarded: true, reversedAt: null },
    });

    await activateChallenge(adminId);

    const [totalAfter, awardAfter, ledgerAfter, tokenLedgerAfter, userAfter] =
      await Promise.all([
        prisma.challengeUserTotal.findUniqueOrThrow({
          where: { challengeId_userId: { challengeId: challenge.id, userId } },
        }),
        prisma.challengeBookingAward.findUniqueOrThrow({
          where: {
            challengeId_bookingId: {
              challengeId: challenge.id,
              bookingId: booking.id,
            },
          },
        }),
        prisma.challengePointLedger.count({ where: { userId } }),
        prisma.tokenLedger.count({ where: { userId } }),
        prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { role: true, bookingBlocked: true },
        }),
      ]);

    expect(totalAfter.points).toBe(0);
    expect(awardAfter.isAwarded).toBe(false);
    expect(ledgerAfter).toBe(ledgerBefore);
    expect(tokenLedgerAfter).toBe(tokenLedgerBefore);
    expect(userAfter).toEqual(userBefore);

    const response = await GET_LEADERBOARD(
      new Request(
        "https://example.test/api/admin/challenge/leaderboard?page=1&pageSize=100"
      ) as any
    );
    expect(response.status).toBe(200);
    const leaderboard = await response.json();
    expect(
      leaderboard.items.find((item: { id: string }) => item.id === userId)
    ).toMatchObject({ points: 0 });
  });

  it("rolls attendance and award writes back when the aggregate update fails", async () => {
    const challenge = await activateChallenge(adminId);
    const cls = await createClass(true);
    await setClassChallengePoints(cls.id, 10);
    const booking = await createBooking(cls.id, secondUserId);
    await prisma.challengeUserTotal.create({
      data: {
        challengeId: challenge.id,
        userId: secondUserId,
        points: 2_147_483_647,
      },
    });

    await expect(
      updateAttendanceWithChallenge({
        bookingId: booking.id,
        attended: true,
        actorUserId: coachId,
      })
    ).rejects.toBeTruthy();

    await expect(prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .resolves.toMatchObject({ attended: false });
    expect(await prisma.challengeBookingAward.count({ where: { bookingId: booking.id } })).toBe(0);
    expect(await prisma.challengePointLedger.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("keeps leaderboard private, deterministic, paginated, and current after reversals", async () => {
    await activateChallenge(adminId);
    const cls = await createClass(true);
    await setClassChallengePoints(cls.id, 3);
    const first = await createBooking(cls.id, userId);
    const secondClass = await createClass(true, "Second leaderboard class");
    await setClassChallengePoints(secondClass.id, 3);
    const second = await createBooking(secondClass.id, secondUserId);
    await updateAttendanceWithChallenge({ bookingId: first.id, attended: true, actorUserId: coachId });
    await updateAttendanceWithChallenge({ bookingId: second.id, attended: true, actorUserId: coachId });

    const request = new Request(
      "https://example.test/api/admin/challenge/leaderboard?page=1&pageSize=2"
    ) as any;
    let response = await GET_LEADERBOARD(request);
    expect(response.status).toBe(200);
    const tied = await response.json();
    expect(tied.items.map((item: { name: string }) => item.name)).toEqual([
      "Ana Challenge",
      "Beto Challenge",
    ]);
    expect(tied.pageSize).toBe(2);

    await updateAttendanceWithChallenge({ bookingId: first.id, attended: false, actorUserId: coachId });
    response = await GET_LEADERBOARD(request);
    const reversed = await response.json();
    expect(reversed.items[0]).toMatchObject({ name: "Beto Challenge", points: 3 });

    authState.userId = coachId;
    response = await GET_LEADERBOARD(request);
    expect(response.status).toBe(403);
  });
});
