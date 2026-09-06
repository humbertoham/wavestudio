import {
  AccountingAuditType,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { startOfWeek } from "date-fns";
import { utcToZonedTime, zonedTimeToUtc } from "date-fns-tz";

import { prisma } from "@/lib/prisma";

export const PAYROLL_TIME_ZONE = "America/Monterrey";
export const MAX_PAYROLL_RATE = new Prisma.Decimal("99999999.99");

const SERIALIZABLE_ATTEMPTS = 3;

export type PayrollErrorCode =
  | "INVALID_INSTRUCTOR_NAME"
  | "INVALID_PAYROLL_RATE"
  | "INSTRUCTOR_NOT_FOUND"
  | "INSTRUCTOR_RATE_REQUIRED"
  | "CLASS_NOT_FOUND"
  | "INVALID_MONTH"
  | "PAYROLL_CONFLICT";

export class PayrollError extends Error {
  constructor(
    public readonly code: PayrollErrorCode,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "PayrollError";
  }
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function runPayrollTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  client: PrismaClient = prisma
) {
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < SERIALIZABLE_ATTEMPTS) {
        continue;
      }
      if (isRetryableTransactionError(error)) {
        throw new PayrollError(
          "PAYROLL_CONFLICT",
          "La información contable cambió durante la operación. Intenta nuevamente.",
          409
        );
      }
      throw error;
    }
  }

  throw new PayrollError(
    "PAYROLL_CONFLICT",
    "La información contable cambió durante la operación. Intenta nuevamente.",
    409
  );
}

export function parsePayrollRate(value: unknown) {
  const normalized =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new PayrollError(
      "INVALID_PAYROLL_RATE",
      "La tarifa debe ser un monto válido mayor a $0 con máximo 2 decimales.",
      400
    );
  }

  const rate = new Prisma.Decimal(normalized);
  if (rate.lte(0) || rate.gt(MAX_PAYROLL_RATE)) {
    throw new PayrollError(
      "INVALID_PAYROLL_RATE",
      "La tarifa debe ser mayor a $0 y menor a $100,000,000 MXN.",
      400
    );
  }

  return rate.toDecimalPlaces(2);
}

function parseInstructorName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 2 || name.length > 80) {
    throw new PayrollError(
      "INVALID_INSTRUCTOR_NAME",
      "El nombre del instructor debe tener entre 2 y 80 caracteres.",
      400
    );
  }
  return name;
}

export function payrollErrorResponse(error: unknown) {
  return error instanceof PayrollError
    ? {
        status: error.status,
        body: { error: error.code, code: error.code, message: error.message },
      }
    : null;
}

export function redactClassPayroll<T>(record: T): T {
  if (!record || typeof record !== "object") return record;
  const safe = { ...(record as Record<string, unknown>) };
  delete safe.payrollRateSnapshot;
  delete safe.payrollRateEffectiveAt;

  if (safe.instructor && typeof safe.instructor === "object") {
    const instructor = {
      ...(safe.instructor as Record<string, unknown>),
    };
    delete instructor.payrollRate;
    safe.instructor = instructor;
  }

  return safe as T;
}

type InstructorMutationClient = Pick<
  Prisma.TransactionClient,
  "instructor" | "class" | "accountingAudit"
>;

export async function createInstructorWithRate(
  params: {
    name: unknown;
    bio?: unknown;
    payrollRate: unknown;
    actorUserId: string;
  },
  client: PrismaClient = prisma
) {
  const name = parseInstructorName(params.name);
  const rate = parsePayrollRate(params.payrollRate);
  const bio =
    typeof params.bio === "string" && params.bio.trim()
      ? params.bio.trim().slice(0, 200)
      : null;

  return runPayrollTransaction(async (tx) => {
    const instructor = await tx.instructor.create({
      data: { name, bio, payrollRate: rate },
    });

    await tx.accountingAudit.create({
      data: {
        type: AccountingAuditType.INSTRUCTOR_RATE_CHANGED,
        instructorId: instructor.id,
        instructorName: instructor.name,
        previousRate: null,
        newRate: rate,
        actorUserId: params.actorUserId,
      },
    });

    return instructor;
  }, client);
}

export async function updateInstructorWithRate(
  params: {
    instructorId: string;
    name: unknown;
    payrollRate: unknown;
    actorUserId: string;
    now?: Date;
  },
  client: PrismaClient = prisma
) {
  const name = parseInstructorName(params.name);
  const rate = parsePayrollRate(params.payrollRate);
  const effectiveAt = params.now ?? new Date();

  return runPayrollTransaction(async (tx) => {
    const existing = await tx.instructor.findUnique({
      where: { id: params.instructorId },
      select: { id: true, name: true, payrollRate: true },
    });
    if (!existing) {
      throw new PayrollError(
        "INSTRUCTOR_NOT_FOUND",
        "El instructor no existe.",
        404
      );
    }

    const rateChanged = !existing.payrollRate?.equals(rate);
    const instructor = await tx.instructor.update({
      where: { id: existing.id },
      data: { name, payrollRate: rate },
    });

    if (rateChanged) {
      await tx.accountingAudit.create({
        data: {
          type: AccountingAuditType.INSTRUCTOR_RATE_CHANGED,
          instructorId: instructor.id,
          instructorName: instructor.name,
          previousRate: existing.payrollRate,
          newRate: rate,
          actorUserId: params.actorUserId,
        },
      });
    }

    // UAT rollout rule: only the first configured rate initializes legacy
    // future assignments. Past classes are deliberately left without a rate.
    if (existing.payrollRate == null) {
      await tx.class.updateMany({
        where: {
          instructorId: existing.id,
          payrollRateSnapshot: null,
          date: { gte: effectiveAt },
          deletedAt: null,
        },
        data: {
          payrollRateSnapshot: rate,
          payrollRateEffectiveAt: effectiveAt,
        },
      });
    }

    return instructor;
  }, client);
}

export async function getInstructorPayrollSnapshot(
  tx: Pick<Prisma.TransactionClient, "instructor">,
  instructorId: string,
  effectiveAt = new Date()
) {
  const instructor = await tx.instructor.findUnique({
    where: { id: instructorId },
    select: { id: true, name: true, payrollRate: true, isVisible: true },
  });

  if (!instructor || !instructor.isVisible) {
    throw new PayrollError(
      "INSTRUCTOR_NOT_FOUND",
      "El instructor no existe o ya no está activo.",
      404
    );
  }
  if (instructor.payrollRate == null || instructor.payrollRate.lte(0)) {
    throw new PayrollError(
      "INSTRUCTOR_RATE_REQUIRED",
      `Configura una tarifa válida para ${instructor.name} antes de asignarle una clase.`,
      409
    );
  }

  return {
    instructor,
    payrollRateSnapshot: instructor.payrollRate,
    payrollRateEffectiveAt: effectiveAt,
  };
}

export async function updateClassWithPayrollAssignment(
  tx: InstructorMutationClient,
  params: {
    classId: string;
    data: Prisma.ClassUncheckedUpdateInput;
    instructorId?: string;
    actorUserId: string;
    effectiveAt?: Date;
    includeBookings?: boolean;
  }
) {
  const existing = await tx.class.findUnique({
    where: { id: params.classId },
    select: {
      id: true,
      title: true,
      instructorId: true,
      payrollRateSnapshot: true,
      deletedAt: true,
      instructor: { select: { name: true } },
    },
  });

  if (!existing || existing.deletedAt) {
    throw new PayrollError("CLASS_NOT_FOUND", "La clase no existe.", 404);
  }

  const data: Prisma.ClassUncheckedUpdateInput = { ...params.data };
  const nextInstructorId = params.instructorId?.trim();
  const isReassignment =
    nextInstructorId != null && nextInstructorId !== existing.instructorId;
  let nextInstructor:
    | Awaited<ReturnType<typeof getInstructorPayrollSnapshot>>["instructor"]
    | null = null;

  if (params.instructorId !== undefined && !nextInstructorId) {
    throw new PayrollError(
      "INSTRUCTOR_NOT_FOUND",
      "Selecciona un instructor válido.",
      400
    );
  }

  if (isReassignment && nextInstructorId) {
    const snapshot = await getInstructorPayrollSnapshot(
      tx,
      nextInstructorId,
      params.effectiveAt
    );
    nextInstructor = snapshot.instructor;
    data.instructorId = nextInstructorId;
    data.payrollRateSnapshot = snapshot.payrollRateSnapshot;
    data.payrollRateEffectiveAt = snapshot.payrollRateEffectiveAt;
  }

  const updated = await tx.class.update({
    where: { id: existing.id },
    data,
    include: {
      instructor: true,
      ...(params.includeBookings ? { bookings: true } : {}),
    },
  });

  if (isReassignment && nextInstructor) {
    await tx.accountingAudit.create({
      data: {
        type: AccountingAuditType.CLASS_INSTRUCTOR_REASSIGNED,
        classId: existing.id,
        classTitle: existing.title,
        previousInstructorId: existing.instructorId,
        previousInstructorName: existing.instructor.name,
        newInstructorId: nextInstructor.id,
        newInstructorName: nextInstructor.name,
        previousRate: existing.payrollRateSnapshot,
        newRate: updated.payrollRateSnapshot,
        actorUserId: params.actorUserId,
      },
    });
  }

  return updated;
}

export type PayrollClassInput = {
  id: string;
  title: string;
  date: Date;
  durationMin: number;
  isCanceled: boolean;
  deletedAt: Date | null;
  payrollRateSnapshot: Prisma.Decimal | null;
  payrollRateEffectiveAt: Date | null;
  instructor: {
    id: string;
    name: string;
    payrollRate: Prisma.Decimal | null;
  };
};

export type PayrollReassignmentAudit = {
  classId: string | null;
  previousInstructorName: string | null;
  newInstructorName: string | null;
  previousRate: Prisma.Decimal | null;
  newRate: Prisma.Decimal | null;
  createdAt: Date;
  actor: { name: string } | null;
};

function localDateParts(date: Date) {
  const local = utcToZonedTime(date, PAYROLL_TIME_ZONE);
  return {
    date: local,
    year: local.getFullYear(),
    month: local.getMonth() + 1,
    day: local.getDate(),
    hour: local.getHours(),
    minute: local.getMinutes(),
  };
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function currentPayrollMonth(now = new Date()) {
  const local = localDateParts(now);
  return `${local.year}-${String(local.month).padStart(2, "0")}`;
}

export function getPayrollMonthRange(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const year = Number(match?.[1]);
  const monthNumber = Number(match?.[2]);
  if (!match || year < 2000 || year > 2100 || monthNumber < 1 || monthNumber > 12) {
    throw new PayrollError(
      "INVALID_MONTH",
      "Selecciona un mes válido.",
      400
    );
  }

  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return {
    month,
    from: zonedTimeToUtc(
      `${year}-${String(monthNumber).padStart(2, "0")}-01 00:00:00`,
      PAYROLL_TIME_ZONE
    ),
    to: zonedTimeToUtc(
      `${nextYear}-${String(nextMonth).padStart(2, "0")}-01 00:00:00`,
      PAYROLL_TIME_ZONE
    ),
  };
}

export function buildPayrollReport(
  month: string,
  classes: PayrollClassInput[],
  audits: PayrollReassignmentAudit[] = []
) {
  const range = getPayrollMonthRange(month);
  const auditByClass = new Map<string, PayrollReassignmentAudit>();
  for (const audit of audits) {
    if (audit.classId && !auditByClass.has(audit.classId)) {
      auditByClass.set(audit.classId, audit);
    }
  }

  type WeekAccumulator = {
    weekStart: string;
    weekEnd: string;
    total: Prisma.Decimal;
    classCount: number;
    classes: Array<Record<string, unknown>>;
  };
  type InstructorAccumulator = {
    id: string;
    name: string;
    currentRate: string | null;
    total: Prisma.Decimal;
    classCount: number;
    listedClassCount: number;
    missingSnapshotCount: number;
    weeks: Map<string, WeekAccumulator>;
  };

  const instructors = new Map<string, InstructorAccumulator>();
  let overallTotal = new Prisma.Decimal(0);
  let payableClassCount = 0;
  let canceledClassCount = 0;
  let missingSnapshotCount = 0;

  const periodClasses = classes.filter(
    (cls) =>
      cls.deletedAt == null && cls.date >= range.from && cls.date < range.to
  );

  for (const cls of [...periodClasses].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  )) {
    const local = localDateParts(cls.date);
    const weekStartDate = startOfWeek(local.date, { weekStartsOn: 1 });
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekKey = dateKey(weekStartDate);
    const instructor = instructors.get(cls.instructor.id) ?? {
      id: cls.instructor.id,
      name: cls.instructor.name,
      currentRate: cls.instructor.payrollRate?.toFixed(2) ?? null,
      total: new Prisma.Decimal(0),
      classCount: 0,
      listedClassCount: 0,
      missingSnapshotCount: 0,
      weeks: new Map<string, WeekAccumulator>(),
    };
    const week = instructor.weeks.get(weekKey) ?? {
      weekStart: weekKey,
      weekEnd: dateKey(weekEndDate),
      total: new Prisma.Decimal(0),
      classCount: 0,
      classes: [],
    };
    const payable =
      !cls.isCanceled && !cls.deletedAt && cls.payrollRateSnapshot != null;
    const missingSnapshot = cls.payrollRateSnapshot == null;
    const rate = cls.payrollRateSnapshot ?? new Prisma.Decimal(0);

    if (payable) {
      week.total = week.total.plus(rate);
      instructor.total = instructor.total.plus(rate);
      overallTotal = overallTotal.plus(rate);
      week.classCount += 1;
      instructor.classCount += 1;
      payableClassCount += 1;
    } else if (cls.isCanceled) {
      canceledClassCount += 1;
    }
    if (missingSnapshot) {
      instructor.missingSnapshotCount += 1;
      missingSnapshotCount += 1;
    }

    const audit = auditByClass.get(cls.id);
    week.classes.push({
      id: cls.id,
      title: cls.title,
      date: cls.date.toISOString(),
      localDate: `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`,
      localTime: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
      durationMin: cls.durationMin,
      rate: cls.payrollRateSnapshot?.toFixed(2) ?? null,
      effectiveAt: cls.payrollRateEffectiveAt?.toISOString() ?? null,
      status: cls.isCanceled
        ? "CANCELED"
        : missingSnapshot
          ? "MISSING_SNAPSHOT"
          : "PAYABLE",
      reassignment: audit
        ? {
            previousInstructorName: audit.previousInstructorName,
            newInstructorName: audit.newInstructorName,
            previousRate: audit.previousRate?.toFixed(2) ?? null,
            newRate: audit.newRate?.toFixed(2) ?? null,
            createdAt: audit.createdAt.toISOString(),
            actorName: audit.actor?.name ?? null,
          }
        : null,
    });
    instructor.listedClassCount += 1;
    instructor.weeks.set(weekKey, week);
    instructors.set(instructor.id, instructor);
  }

  return {
    month,
    timeZone: PAYROLL_TIME_ZONE,
    summary: {
      total: overallTotal.toFixed(2),
      instructorCount: instructors.size,
      payableClassCount,
      canceledClassCount,
      missingSnapshotCount,
    },
    instructors: [...instructors.values()]
      .sort((a, b) => b.total.comparedTo(a.total) || a.name.localeCompare(b.name, "es"))
      .map((instructor) => ({
        id: instructor.id,
        name: instructor.name,
        currentRate: instructor.currentRate,
        classCount: instructor.classCount,
        listedClassCount: instructor.listedClassCount,
        missingSnapshotCount: instructor.missingSnapshotCount,
        monthlyTotal: instructor.total.toFixed(2),
        weeks: [...instructor.weeks.values()]
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
          .map((week) => ({
            weekStart: week.weekStart,
            weekEnd: week.weekEnd,
            total: week.total.toFixed(2),
            classCount: week.classCount,
            classes: week.classes,
          })),
      })),
  };
}

export async function getPayrollReport(
  month: string,
  client: PrismaClient = prisma
) {
  const range = getPayrollMonthRange(month);

  return client.$transaction(
    async (tx) => {
      const classes = await tx.class.findMany({
        where: {
          date: { gte: range.from, lt: range.to },
          deletedAt: null,
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          date: true,
          durationMin: true,
          isCanceled: true,
          deletedAt: true,
          payrollRateSnapshot: true,
          payrollRateEffectiveAt: true,
          instructor: {
            select: { id: true, name: true, payrollRate: true },
          },
        },
      });
      const classIds = classes.map((cls) => cls.id);
      const audits =
        classIds.length === 0
          ? []
          : await tx.accountingAudit.findMany({
              where: {
                type: AccountingAuditType.CLASS_INSTRUCTOR_REASSIGNED,
                classId: { in: classIds },
              },
              orderBy: { createdAt: "desc" },
              select: {
                classId: true,
                previousInstructorName: true,
                newInstructorName: true,
                previousRate: true,
                newRate: true,
                createdAt: true,
                actor: { select: { name: true } },
              },
            });

      return buildPayrollReport(month, classes, audits);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
  );
}
