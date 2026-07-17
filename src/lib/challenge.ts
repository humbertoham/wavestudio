import {
  ChallengePointReason,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const CHALLENGE_KEY = "WAVE_CHALLENGE";
export const CHALLENGE_NAME = "WAVE Challenge";
export const CHALLENGE_LOCK_KEY = "wave-studio:challenge:lifecycle";
export const CHALLENGE_MIN_POINTS = 1;
export const CHALLENGE_MAX_POINTS = 10;

const SERIALIZABLE_ATTEMPTS = 3;

export type ChallengeErrorCode =
  | "CHALLENGE_NOT_ACTIVE"
  | "CHALLENGE_ALREADY_ACTIVE"
  | "CHALLENGE_ALREADY_INACTIVE"
  | "CLASS_NOT_FOUND"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_ACTIVE"
  | "CLASS_NOT_CHALLENGE_ELIGIBLE"
  | "INVALID_CHALLENGE_POINTS"
  | "CLASS_CHALLENGE_POINTS_LOCKED"
  | "CHALLENGE_AWARD_CONFLICT";

export class ChallengeError extends Error {
  constructor(
    public readonly code: ChallengeErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}

function isRetryable(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function lockChallengeTransaction(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${CHALLENGE_LOCK_KEY}))
  `;
}

export async function runChallengeTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = prisma
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx) => {
          await lockChallengeTransaction(tx);
          return callback(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (isRetryable(error) && attempt < SERIALIZABLE_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new ChallengeError(
    "CHALLENGE_AWARD_CONFLICT",
    "El Challenge cambió durante la operación. Intenta nuevamente.",
    409
  );
}

export async function getClassChallengeSnapshot(
  tx: Prisma.TransactionClient
) {
  const challenge = await tx.challenge.findUnique({
    where: { key: CHALLENGE_KEY },
    select: {
      id: true,
      isActive: true,
      activationVersion: true,
    },
  });

  if (!challenge?.isActive) {
    return {
      challengeId: null,
      challengePoints: null,
      challengeEligibleAt: null,
      challengeActivationVersion: null,
    };
  }

  return {
    challengeId: challenge.id,
    challengePoints: 1,
    challengeEligibleAt: new Date(),
    challengeActivationVersion: challenge.activationVersion,
  };
}

async function resetCurrentChallengeProgress(
  tx: Prisma.TransactionClient,
  challengeId: string,
  resetAt: Date
) {
  // ChallengePointLedger is the immutable historical record. Only mutable
  // current-cycle aggregates/state are reset during a lifecycle transition.
  await tx.challengeUserTotal.updateMany({
    where: { challengeId },
    data: { points: 0 },
  });
  await tx.challengeBookingAward.updateMany({
    where: { challengeId, isAwarded: true },
    data: { isAwarded: false, reversedAt: resetAt },
  });
}

export async function activateChallenge(
  actorUserId: string,
  client: PrismaClient = prisma
) {
  return runChallengeTransaction(async (tx) => {
    const current = await tx.challenge.findUnique({
      where: { key: CHALLENGE_KEY },
    });

    if (current?.isActive) {
      throw new ChallengeError(
        "CHALLENGE_ALREADY_ACTIVE",
        "El Challenge ya está activo.",
        409
      );
    }

    const now = new Date();
    const challenge = current
      ? await tx.challenge.update({
          where: { id: current.id },
          data: {
            isActive: true,
            activationVersion: { increment: 1 },
            activatedAt: now,
            activatedById: actorUserId,
            deactivatedAt: null,
            deactivatedById: null,
          },
        })
      : await tx.challenge.create({
          data: {
            key: CHALLENGE_KEY,
            name: CHALLENGE_NAME,
            isActive: true,
            activationVersion: 1,
            activatedAt: now,
            activatedById: actorUserId,
          },
        });

    await resetCurrentChallengeProgress(tx, challenge.id, now);
    return challenge;
  }, client);
}

export async function deactivateChallenge(
  actorUserId: string,
  client: PrismaClient = prisma
) {
  return runChallengeTransaction(async (tx) => {
    const current = await tx.challenge.findUnique({
      where: { key: CHALLENGE_KEY },
    });

    if (!current?.isActive) {
      throw new ChallengeError(
        "CHALLENGE_ALREADY_INACTIVE",
        "El Challenge ya está inactivo.",
        409
      );
    }

    const now = new Date();
    const challenge = await tx.challenge.update({
      where: { id: current.id },
      data: {
        isActive: false,
        deactivatedAt: now,
        deactivatedById: actorUserId,
      },
    });

    await resetCurrentChallengeProgress(tx, challenge.id, now);
    return challenge;
  }, client);
}

export async function getChallengeStatus(userId?: string | null) {
  const challenge = await prisma.challenge.findUnique({
    where: { key: CHALLENGE_KEY },
    select: {
      id: true,
      name: true,
      isActive: true,
      activationVersion: true,
      activatedAt: true,
      deactivatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!challenge) {
    return {
      id: null,
      name: CHALLENGE_NAME,
      active: false,
      activationVersion: 0,
      activatedAt: null,
      deactivatedAt: null,
      createdAt: null,
      updatedAt: null,
      points: 0,
    };
  }

  const total = userId
    ? await prisma.challengeUserTotal.findUnique({
        where: {
          challengeId_userId: { challengeId: challenge.id, userId },
        },
        select: { points: true },
      })
    : null;

  return {
    id: challenge.id,
    name: challenge.name,
    active: challenge.isActive,
    activationVersion: challenge.activationVersion,
    activatedAt: challenge.activatedAt,
    deactivatedAt: challenge.deactivatedAt,
    createdAt: challenge.createdAt,
    updatedAt: challenge.updatedAt,
    points: total?.points ?? 0,
  };
}

export function parseChallengePoints(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < CHALLENGE_MIN_POINTS ||
    value > CHALLENGE_MAX_POINTS
  ) {
    throw new ChallengeError(
      "INVALID_CHALLENGE_POINTS",
      "Los puntos del Challenge deben ser un número entero entre 1 y 10.",
      400
    );
  }

  return value;
}

export async function setClassChallengePoints(
  classId: string,
  pointsValue: unknown
) {
  const points = parseChallengePoints(pointsValue);

  return runChallengeTransaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({
      where: { key: CHALLENGE_KEY },
      select: { id: true, isActive: true },
    });

    if (!challenge?.isActive) {
      throw new ChallengeError(
        "CHALLENGE_NOT_ACTIVE",
        "El Challenge no está activo.",
        409
      );
    }

    const cls = await tx.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        deletedAt: true,
        challengeId: true,
        challengePoints: true,
        challengeEligibleAt: true,
      },
    });

    if (!cls || cls.deletedAt) {
      throw new ChallengeError("CLASS_NOT_FOUND", "La clase no existe.", 404);
    }

    if (
      cls.challengeId !== challenge.id ||
      !cls.challengeEligibleAt ||
      cls.challengePoints == null
    ) {
      throw new ChallengeError(
        "CLASS_NOT_CHALLENGE_ELIGIBLE",
        "Esta clase no es elegible para el Challenge.",
        409
      );
    }

    const awardExists = await tx.challengeBookingAward.findFirst({
      where: { challengeId: challenge.id, classId },
      select: { id: true },
    });

    if (awardExists) {
      throw new ChallengeError(
        "CLASS_CHALLENGE_POINTS_LOCKED",
        "Los puntos de esta clase están bloqueados porque ya existe una asignación.",
        409
      );
    }

    return tx.class.update({
      where: { id: classId },
      data: { challengePoints: points },
      select: {
        id: true,
        challengeId: true,
        challengePoints: true,
        challengeEligibleAt: true,
        challengeActivationVersion: true,
      },
    });
  });
}

export async function updateAttendanceWithChallenge(params: {
  bookingId: string;
  attended: boolean;
  actorUserId: string;
}) {
  return runChallengeTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: params.bookingId },
      select: {
        id: true,
        status: true,
        attended: true,
        userId: true,
        classId: true,
        class: {
          select: {
            isCanceled: true,
            challengeId: true,
            challengePoints: true,
            challengeEligibleAt: true,
            challengeActivationVersion: true,
          },
        },
      },
    });

    if (!booking) {
      throw new ChallengeError("BOOKING_NOT_FOUND", "La reserva no existe.", 404);
    }

    if (booking.status !== "ACTIVE") {
      throw new ChallengeError(
        "BOOKING_NOT_ACTIVE",
        "La reserva no está activa.",
        400
      );
    }

    if (booking.attended === params.attended) {
      const currentTotal = booking.userId
        ? await tx.challengeUserTotal.findFirst({
            where: { userId: booking.userId },
            orderBy: { updatedAt: "desc" },
            select: { points: true },
          })
        : null;

      return {
        id: booking.id,
        attended: booking.attended,
        changed: false,
        challenge: { delta: 0, points: currentTotal?.points ?? 0 },
      };
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { attended: params.attended },
    });

    // Guests keep normal attendance behavior but never enter the Challenge domain.
    if (!booking.userId) {
      return {
        id: booking.id,
        attended: params.attended,
        changed: true,
        challenge: { delta: 0, points: 0 },
      };
    }

    const challenge = await tx.challenge.findUnique({
      where: { key: CHALLENGE_KEY },
      select: { id: true, isActive: true },
    });

    if (params.attended) {
      // Attendance remains successful while inactive/ineligible; no deferred award
      // is created, so a later activation cannot backfill this transition.
      if (
        !challenge?.isActive ||
        challenge.id !== booking.class.challengeId ||
        !booking.class.challengeEligibleAt ||
        booking.class.challengePoints == null ||
        booking.class.isCanceled
      ) {
        return {
          id: booking.id,
          attended: true,
          changed: true,
          challenge: { delta: 0, points: 0 },
        };
      }

      const existing = await tx.challengeBookingAward.findUnique({
        where: {
          challengeId_bookingId: {
            challengeId: challenge.id,
            bookingId: booking.id,
          },
        },
      });

      if (existing?.isAwarded) {
        throw new ChallengeError(
          "CHALLENGE_AWARD_CONFLICT",
          "La asistencia ya tiene puntos activos del Challenge.",
          409
        );
      }

      const points = existing?.pointsSnapshot ?? booking.class.challengePoints;
      const cycle = existing ? existing.cycle + 1 : 1;
      const now = new Date();

      if (existing) {
        await tx.challengeBookingAward.update({
          where: { id: existing.id },
          data: {
            isAwarded: true,
            cycle,
            awardedAt: now,
            reversedAt: null,
          },
        });
      } else {
        await tx.challengeBookingAward.create({
          data: {
            challengeId: challenge.id,
            bookingId: booking.id,
            classId: booking.classId,
            userId: booking.userId,
            pointsSnapshot: points,
            cycle,
            isAwarded: true,
            awardedAt: now,
          },
        });
      }

      await tx.challengePointLedger.create({
        data: {
          challengeId: challenge.id,
          bookingId: booking.id,
          classId: booking.classId,
          userId: booking.userId,
          actorUserId: params.actorUserId,
          delta: points,
          reason: ChallengePointReason.ATTENDANCE_AWARD,
          pointsSnapshot: points,
          cycle,
          idempotencyKey: `challenge:${challenge.id}:booking:${booking.id}:award:${cycle}`,
          metadata: {
            activationVersion: booking.class.challengeActivationVersion,
          },
        },
      });

      const total = await tx.challengeUserTotal.upsert({
        where: {
          challengeId_userId: {
            challengeId: challenge.id,
            userId: booking.userId,
          },
        },
        create: {
          challengeId: challenge.id,
          userId: booking.userId,
          points,
        },
        update: { points: { increment: points } },
        select: { points: true },
      });

      return {
        id: booking.id,
        attended: true,
        changed: true,
        challenge: { delta: points, points: total.points },
      };
    }

    // Reversal is based on the exact award snapshot and remains available while
    // paused so attendance and Challenge totals cannot diverge.
    if (!challenge) {
      return {
        id: booking.id,
        attended: false,
        changed: true,
        challenge: { delta: 0, points: 0 },
      };
    }

    const existing = await tx.challengeBookingAward.findUnique({
      where: {
        challengeId_bookingId: {
          challengeId: challenge.id,
          bookingId: booking.id,
        },
      },
    });

    if (!existing?.isAwarded) {
      return {
        id: booking.id,
        attended: false,
        changed: true,
        challenge: { delta: 0, points: 0 },
      };
    }

    const updatedTotal = await tx.challengeUserTotal.updateMany({
      where: {
        challengeId: challenge.id,
        userId: booking.userId,
        points: { gte: existing.pointsSnapshot },
      },
      data: { points: { decrement: existing.pointsSnapshot } },
    });

    if (updatedTotal.count !== 1) {
      throw new ChallengeError(
        "CHALLENGE_AWARD_CONFLICT",
        "El total del Challenge cambió durante la reversión.",
        409
      );
    }

    await tx.challengeBookingAward.update({
      where: { id: existing.id },
      data: { isAwarded: false, reversedAt: new Date() },
    });

    await tx.challengePointLedger.create({
      data: {
        challengeId: challenge.id,
        bookingId: booking.id,
        classId: booking.classId,
        userId: booking.userId,
        actorUserId: params.actorUserId,
        delta: -existing.pointsSnapshot,
        reason: ChallengePointReason.ATTENDANCE_REVERSAL,
        pointsSnapshot: existing.pointsSnapshot,
        cycle: existing.cycle,
        idempotencyKey: `challenge:${challenge.id}:booking:${booking.id}:reversal:${existing.cycle}`,
        metadata: {
          activationVersion: booking.class.challengeActivationVersion,
        },
      },
    });

    const total = await tx.challengeUserTotal.findUnique({
      where: {
        challengeId_userId: {
          challengeId: challenge.id,
          userId: booking.userId,
        },
      },
      select: { points: true },
    });

    return {
      id: booking.id,
      attended: false,
      changed: true,
      challenge: {
        delta: -existing.pointsSnapshot,
        points: total?.points ?? 0,
      },
    };
  });
}

export function challengeErrorResponse(error: unknown) {
  if (error instanceof ChallengeError) {
    return {
      status: error.status,
      body: { error: error.code, code: error.code, message: error.message },
    };
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  ) {
    return {
      status: 409,
      body: {
        error: "CHALLENGE_AWARD_CONFLICT",
        code: "CHALLENGE_AWARD_CONFLICT",
        message: "El Challenge cambió durante la operación. Intenta nuevamente.",
      },
    };
  }

  return null;
}
