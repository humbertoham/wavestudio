import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PayrollError,
  buildPayrollReport,
  createInstructorWithRate,
  getInstructorPayrollSnapshot,
  getPayrollMonthRange,
  parsePayrollRate,
  redactClassPayroll,
  runPayrollTransaction,
  updateClassWithPayrollAssignment,
  updateInstructorWithRate,
  type PayrollClassInput,
} from "./payroll";

const decimal = (value: string | number) => new Prisma.Decimal(value);

function transactionClient(tx: Record<string, unknown>) {
  return {
    $transaction: vi.fn(async (callback: (value: unknown) => unknown) =>
      callback(tx)
    ),
  } as any;
}

function payrollClass(
  values: Partial<PayrollClassInput> & Pick<PayrollClassInput, "id" | "date">
): PayrollClassInput {
  return {
    id: values.id,
    title: values.title ?? values.id,
    date: values.date,
    durationMin: values.durationMin ?? 60,
    isCanceled: values.isCanceled ?? false,
    deletedAt: values.deletedAt ?? null,
    payrollRateSnapshot:
      values.payrollRateSnapshot === undefined
        ? decimal("150.00")
        : values.payrollRateSnapshot,
    payrollRateEffectiveAt:
      values.payrollRateEffectiveAt === undefined
        ? new Date("2026-08-01T12:00:00.000Z")
        : values.payrollRateEffectiveAt,
    instructor: values.instructor ?? {
      id: "coach_a",
      name: "Coach A",
      payrollRate: decimal("150.00"),
    },
  };
}

describe("payroll rate validation", () => {
  it.each([
    ["150", "150.00"],
    ["150.5", "150.50"],
    [150.25, "150.25"],
    ["0001.20", "1.20"],
  ])("accepts %s as a positive MXN rate", (input, expected) => {
    expect(parsePayrollRate(input).toFixed(2)).toBe(expected);
  });

  it.each(["", "   ", "0", "0.00", -1, "-1", "1.234", "abc", "1e3"])(
    "rejects invalid rate %s",
    (input) => {
      expect(() => parsePayrollRate(input)).toThrowError(
        expect.objectContaining({ code: "INVALID_PAYROLL_RATE", status: 400 })
      );
    }
  );

  it("rejects values outside Decimal(10,2)", () => {
    expect(() => parsePayrollRate("100000000.00")).toThrowError(PayrollError);
  });
});

describe("instructor payroll rate mutations", () => {
  let tx: any;

  beforeEach(() => {
    tx = {
      instructor: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      class: { updateMany: vi.fn() },
      accountingAudit: { create: vi.fn() },
    };
  });

  it("creates an instructor with a Decimal rate and an audit record", async () => {
    tx.instructor.create.mockImplementation(async ({ data }: any) => ({
      id: "coach_a",
      ...data,
    }));

    const result = await createInstructorWithRate(
      {
        name: " Coach A ",
        payrollRate: "150.00",
        actorUserId: "admin_1",
      },
      transactionClient(tx)
    );

    expect(result.name).toBe("Coach A");
    expect(result.payrollRate!.toFixed(2)).toBe("150.00");
    expect(tx.accountingAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "INSTRUCTOR_RATE_CHANGED",
        instructorId: "coach_a",
        previousRate: null,
        actorUserId: "admin_1",
      }),
    });
  });

  it("does not rewrite class snapshots when an existing rate changes", async () => {
    tx.instructor.findUnique.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: decimal("150.00"),
    });
    tx.instructor.update.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: decimal("180.00"),
    });

    await updateInstructorWithRate(
      {
        instructorId: "coach_a",
        name: "Coach A",
        payrollRate: "180",
        actorUserId: "admin_1",
      },
      transactionClient(tx)
    );

    expect(tx.class.updateMany).not.toHaveBeenCalled();
    expect(tx.accountingAudit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        previousRate: expect.objectContaining({}),
        newRate: expect.objectContaining({}),
      }),
    });
    const audit = tx.accountingAudit.create.mock.calls[0][0].data;
    expect(audit.previousRate.toFixed(2)).toBe("150.00");
    expect(audit.newRate.toFixed(2)).toBe("180.00");
  });

  it("initializes only unsnapshotted future classes when a legacy instructor gets a rate", async () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    tx.instructor.findUnique.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: null,
    });
    tx.instructor.update.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: decimal("150.00"),
    });

    await updateInstructorWithRate(
      {
        instructorId: "coach_a",
        name: "Coach A",
        payrollRate: "150",
        actorUserId: "admin_1",
        now,
      },
      transactionClient(tx)
    );

    expect(tx.class.updateMany).toHaveBeenCalledWith({
      where: {
        instructorId: "coach_a",
        payrollRateSnapshot: null,
        date: { gte: now },
        deletedAt: null,
      },
      data: {
        payrollRateSnapshot: expect.objectContaining({}),
        payrollRateEffectiveAt: now,
      },
    });
  });
});

describe("class payroll assignment", () => {
  it("rejects assigning an instructor without a configured rate", async () => {
    const tx = {
      instructor: {
        findUnique: vi.fn().mockResolvedValue({
          id: "coach_a",
          name: "Coach A",
          payrollRate: null,
          isVisible: true,
        }),
      },
    } as any;

    await expect(getInstructorPayrollSnapshot(tx, "coach_a")).rejects.toMatchObject({
      code: "INSTRUCTOR_RATE_REQUIRED",
      status: 409,
    });
  });

  it("returns the instructor's current Decimal rate for a new assignment", async () => {
    const tx = {
      instructor: {
        findUnique: vi.fn().mockResolvedValue({
          id: "coach_a",
          name: "Coach A",
          payrollRate: decimal("180.00"),
          isVisible: true,
        }),
      },
    } as any;

    const snapshot = await getInstructorPayrollSnapshot(
      tx,
      "coach_a",
      new Date("2026-09-05T12:00:00.000Z")
    );
    expect(snapshot.payrollRateSnapshot.toFixed(2)).toBe("180.00");
  });

  it("reassignment replaces Coach A's snapshot with Coach B's rate and audits atomically", async () => {
    const tx = {
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: "class_1",
          title: "Flow",
          instructorId: "coach_a",
          payrollRateSnapshot: decimal("150.00"),
          deletedAt: null,
          instructor: { name: "Coach A" },
        }),
        update: vi.fn().mockImplementation(async ({ data }: any) => ({
          id: "class_1",
          ...data,
          payrollRateSnapshot: data.payrollRateSnapshot,
          bookings: [],
          instructor: { id: "coach_b", name: "Coach B" },
        })),
      },
      instructor: {
        findUnique: vi.fn().mockResolvedValue({
          id: "coach_b",
          name: "Coach B",
          payrollRate: decimal("220.00"),
          isVisible: true,
        }),
      },
      accountingAudit: { create: vi.fn() },
    } as any;

    const result = await updateClassWithPayrollAssignment(tx, {
      classId: "class_1",
      data: {},
      instructorId: "coach_b",
      actorUserId: "admin_1",
    });

    expect(result.payrollRateSnapshot!.toFixed(2)).toBe("220.00");
    expect(tx.class.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          instructorId: "coach_b",
          payrollRateSnapshot: expect.objectContaining({}),
          payrollRateEffectiveAt: expect.any(Date),
        }),
      })
    );
    const audit = tx.accountingAudit.create.mock.calls[0][0].data;
    expect(audit.previousInstructorId).toBe("coach_a");
    expect(audit.newInstructorId).toBe("coach_b");
    expect(audit.previousRate.toFixed(2)).toBe("150.00");
    expect(audit.newRate.toFixed(2)).toBe("220.00");
  });

  it("preserves the snapshot when only the class date changes", async () => {
    const newDate = new Date("2026-10-03T14:00:00.000Z");
    const tx = {
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: "class_1",
          title: "Flow",
          instructorId: "coach_a",
          payrollRateSnapshot: decimal("150.00"),
          deletedAt: null,
          instructor: { name: "Coach A" },
        }),
        update: vi.fn().mockResolvedValue({
          id: "class_1",
          date: newDate,
          payrollRateSnapshot: decimal("150.00"),
          bookings: [],
          instructor: { id: "coach_a", name: "Coach A" },
        }),
      },
      instructor: { findUnique: vi.fn() },
      accountingAudit: { create: vi.fn() },
    } as any;

    await updateClassWithPayrollAssignment(tx, {
      classId: "class_1",
      data: { date: newDate },
      instructorId: "coach_a",
      actorUserId: "admin_1",
    });

    expect(tx.class.update.mock.calls[0][0].data).toEqual({ date: newDate });
    expect(tx.instructor.findUnique).not.toHaveBeenCalled();
    expect(tx.accountingAudit.create).not.toHaveBeenCalled();
  });
});

describe("payroll periods and totals", () => {
  it("uses Monterrey calendar-month boundaries", () => {
    expect(getPayrollMonthRange("2026-09")).toEqual({
      month: "2026-09",
      from: new Date("2026-09-01T06:00:00.000Z"),
      to: new Date("2026-10-01T06:00:00.000Z"),
    });
  });

  it("sums independent classes, weekly totals, coach totals, and overall totals", () => {
    const classes = [
      payrollClass({ id: "a1", date: new Date("2026-09-01T14:00:00.000Z") }),
      payrollClass({ id: "a2", date: new Date("2026-09-01T16:00:00.000Z") }),
      payrollClass({
        id: "a3",
        date: new Date("2026-09-07T14:00:00.000Z"),
        payrollRateSnapshot: decimal("180.00"),
        instructor: {
          id: "coach_a",
          name: "Coach A",
          payrollRate: decimal("180.00"),
        },
      }),
      payrollClass({
        id: "b-canceled",
        date: new Date("2026-09-02T14:00:00.000Z"),
        isCanceled: true,
        payrollRateSnapshot: decimal("220.00"),
        instructor: {
          id: "coach_b",
          name: "Coach B",
          payrollRate: decimal("220.00"),
        },
      }),
      payrollClass({
        id: "legacy",
        date: new Date("2026-09-03T14:00:00.000Z"),
        payrollRateSnapshot: null,
        payrollRateEffectiveAt: null,
      }),
    ];

    const report = buildPayrollReport("2026-09", classes);
    const coachA = report.instructors.find((item) => item.id === "coach_a")!;
    const coachB = report.instructors.find((item) => item.id === "coach_b")!;

    expect(report.summary).toEqual({
      total: "480.00",
      instructorCount: 2,
      payableClassCount: 3,
      canceledClassCount: 1,
      missingSnapshotCount: 1,
    });
    expect(coachA.monthlyTotal).toBe("480.00");
    expect(coachA.classCount).toBe(3);
    expect(coachA.weeks.map((week) => week.total)).toEqual(["300.00", "180.00"]);
    expect(coachB.monthlyTotal).toBe("0.00");
  });

  it("keeps old snapshots after a rate change and uses the new rate only for new classes", () => {
    const currentInstructor = {
      id: "coach_a",
      name: "Coach A",
      payrollRate: decimal("180.00"),
    };
    const report = buildPayrollReport("2026-09", [
      payrollClass({
        id: "old-1",
        date: new Date("2026-09-02T14:00:00.000Z"),
        payrollRateSnapshot: decimal("150.00"),
        instructor: currentInstructor,
      }),
      payrollClass({
        id: "new-1",
        date: new Date("2026-09-09T14:00:00.000Z"),
        payrollRateSnapshot: decimal("180.00"),
        instructor: currentInstructor,
      }),
    ]);

    expect(report.summary.total).toBe("330.00");
  });

  it("reassignment removes A's exact snapshot and gives B only B's current rate", () => {
    const original = payrollClass({
      id: "class_1",
      date: new Date("2026-09-02T14:00:00.000Z"),
      payrollRateSnapshot: decimal("150.00"),
    });
    const reassigned = payrollClass({
      id: "class_1",
      date: original.date,
      payrollRateSnapshot: decimal("220.00"),
      instructor: {
        id: "coach_b",
        name: "Coach B",
        payrollRate: decimal("220.00"),
      },
    });

    expect(buildPayrollReport("2026-09", [original]).summary.total).toBe("150.00");
    const after = buildPayrollReport("2026-09", [reassigned]);
    expect(after.summary.total).toBe("220.00");
    expect(after.instructors.map((item) => item.id)).toEqual(["coach_b"]);
  });

  it("counts a canceled class as zero without subtracting its snapshot twice", () => {
    const canceled = payrollClass({
      id: "class_1",
      date: new Date("2026-09-02T14:00:00.000Z"),
      isCanceled: true,
      payrollRateSnapshot: decimal("220.00"),
    });
    const report = buildPayrollReport("2026-09", [canceled, { ...canceled }]);

    expect(report.summary.total).toBe("0.00");
    expect(report.summary.payableClassCount).toBe(0);
  });

  it("does not duplicate a week that crosses months", () => {
    const report = buildPayrollReport("2026-09", [
      payrollClass({ id: "aug", date: new Date("2026-09-01T05:59:00.000Z") }),
      payrollClass({ id: "sep", date: new Date("2026-09-01T06:00:00.000Z") }),
      payrollClass({ id: "oct", date: new Date("2026-10-01T06:00:00.000Z") }),
    ]);

    expect(report.summary.payableClassCount).toBe(1);
    expect(report.summary.total).toBe("150.00");
    expect(report.instructors[0].weeks[0].weekStart).toBe("2026-08-31");
  });

  it("moves payroll to the class date's month without changing its snapshot", () => {
    const moved = payrollClass({
      id: "class_1",
      date: new Date("2026-10-03T14:00:00.000Z"),
      payrollRateSnapshot: decimal("150.00"),
    });

    expect(buildPayrollReport("2026-09", [moved]).summary.total).toBe("0.00");
    expect(buildPayrollReport("2026-10", [moved]).summary.total).toBe("150.00");
  });

  it("exposes the latest reassignment audit on the class detail", () => {
    const cls = payrollClass({
      id: "class_1",
      date: new Date("2026-09-02T14:00:00.000Z"),
      payrollRateSnapshot: decimal("220.00"),
      instructor: {
        id: "coach_b",
        name: "Coach B",
        payrollRate: decimal("220.00"),
      },
    });
    const report = buildPayrollReport("2026-09", [cls], [
      {
        classId: "class_1",
        previousInstructorName: "Coach A",
        newInstructorName: "Coach B",
        previousRate: decimal("150.00"),
        newRate: decimal("220.00"),
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        actor: { name: "Admin" },
      },
    ]);

    const detail = report.instructors[0].weeks[0].classes[0];
    expect(detail.reassignment).toMatchObject({
      previousInstructorName: "Coach A",
      newInstructorName: "Coach B",
      previousRate: "150.00",
      newRate: "220.00",
      actorName: "Admin",
    });
  });
});

describe("financial field privacy", () => {
  it("removes class and nested instructor rates from shared class-manager responses", () => {
    expect(
      redactClassPayroll({
        id: "class_1",
        payrollRateSnapshot: "150.00",
        payrollRateEffectiveAt: "2026-09-01T00:00:00.000Z",
        instructor: {
          id: "coach_a",
          name: "Coach A",
          payrollRate: "180.00",
        },
      })
    ).toEqual({
      id: "class_1",
      instructor: { id: "coach_a", name: "Coach A" },
    });
  });
});

describe("requested payroll scenarios A through E", () => {
  const septemberDate = (day: number) =>
    new Date(`2026-09-${String(day).padStart(2, "0")}T14:00:00.000Z`);
  const coachA = {
    id: "coach_a",
    name: "Coach A",
    payrollRate: decimal("180.00"),
  };
  const coachB = {
    id: "coach_b",
    name: "Coach B",
    payrollRate: decimal("220.00"),
  };

  function originalClass(index: number) {
    return payrollClass({
      id: `original_${index}`,
      date: septemberDate(index + 1),
      payrollRateSnapshot: decimal("150.00"),
      instructor: coachA,
    });
  }

  it("A: four classes snapshotted at $150 total $600", () => {
    const report = buildPayrollReport(
      "2026-09",
      [0, 1, 2, 3].map(originalClass)
    );
    expect(report.summary.total).toBe("600.00");
  });

  it("B: a new $180 class does not reprice the four $150 classes", () => {
    const report = buildPayrollReport("2026-09", [
      ...[0, 1, 2, 3].map(originalClass),
      payrollClass({
        id: "new_180",
        date: septemberDate(10),
        payrollRateSnapshot: decimal("180.00"),
        instructor: coachA,
      }),
    ]);
    expect(report.summary.total).toBe("780.00");
  });

  it("C and D: reassignment leaves A at $630, gives B $220, then cancellation makes B $0", () => {
    const remainingForA = [1, 2, 3].map(originalClass);
    const newForA = payrollClass({
      id: "new_180",
      date: septemberDate(10),
      payrollRateSnapshot: decimal("180.00"),
      instructor: coachA,
    });
    const reassignedToB = payrollClass({
      id: "original_0",
      date: septemberDate(1),
      payrollRateSnapshot: decimal("220.00"),
      instructor: coachB,
    });
    const reassigned = buildPayrollReport("2026-09", [
      ...remainingForA,
      newForA,
      reassignedToB,
    ]);

    expect(
      reassigned.instructors.find((item) => item.id === "coach_a")?.monthlyTotal
    ).toBe("630.00");
    expect(
      reassigned.instructors.find((item) => item.id === "coach_b")?.monthlyTotal
    ).toBe("220.00");

    const canceled = buildPayrollReport("2026-09", [
      ...remainingForA,
      newForA,
      { ...reassignedToB, isCanceled: true },
    ]);
    expect(
      canceled.instructors.find((item) => item.id === "coach_b")?.monthlyTotal
    ).toBe("0.00");
  });

  it("E: moving a class to October preserves $150 and changes its owning month", () => {
    const moved = {
      ...originalClass(0),
      date: new Date("2026-10-02T14:00:00.000Z"),
    };

    expect(buildPayrollReport("2026-09", [moved]).summary.total).toBe("0.00");
    expect(buildPayrollReport("2026-10", [moved]).summary.total).toBe("150.00");
  });
});

describe("payroll transaction integrity", () => {
  it("retries a serializable write conflict", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      "write conflict",
      { code: "P2034", clientVersion: "test" }
    );
    const client = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(async (callback: (tx: object) => unknown) =>
          callback({})
        ),
    } as any;

    await expect(
      runPayrollTransaction(async () => "ok", client)
    ).resolves.toBe("ok");
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(client.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
