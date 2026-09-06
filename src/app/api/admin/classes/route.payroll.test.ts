import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    class: { create: vi.fn(), createMany: vi.fn() },
  };
  return {
    tx,
    requireAdminUser: vi.fn(),
    getClassChallengeSnapshot: vi.fn(),
    getInstructorPayrollSnapshot: vi.fn(),
  };
});

vi.mock("../_utils", () => ({
  prisma: {},
  requireAdminUser: mocks.requireAdminUser,
}));

vi.mock("@/lib/challenge", () => ({
  getClassChallengeSnapshot: mocks.getClassChallengeSnapshot,
  runChallengeTransaction: (callback: (tx: typeof mocks.tx) => unknown) =>
    callback(mocks.tx),
}));

vi.mock("@/lib/payroll", () => ({
  getInstructorPayrollSnapshot: mocks.getInstructorPayrollSnapshot,
  payrollErrorResponse: (error: unknown) =>
    error instanceof Error && "status" in error
      ? {
          status: (error as Error & { status: number }).status,
          body: {
            error: (error as Error & { code?: string }).code,
            message: error.message,
          },
        }
      : null,
}));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const validBody = {
  title: "Flow",
  focus: "Yoga",
  date: "2026-09-10T08:00",
  durationMin: 60,
  capacity: 12,
  instructorId: "coach_a",
};

describe("POST /api/admin/classes payroll snapshot", () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({
      ok: true,
      user: { id: "admin_1", role: "ADMIN" },
    });
    mocks.getClassChallengeSnapshot.mockResolvedValue({
      challengeId: null,
      challengePoints: null,
      challengeEligibleAt: null,
      challengeActivationVersion: null,
    });
    mocks.getInstructorPayrollSnapshot.mockResolvedValue({
      payrollRateSnapshot: "150.00",
      payrollRateEffectiveAt: new Date("2026-09-05T12:00:00.000Z"),
    });
    mocks.tx.class.create.mockResolvedValue({ id: "class_1" });
    mocks.tx.class.createMany.mockResolvedValue({ count: 4 });
  });

  it("stores the instructor rate snapshot on a new class", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(201);
    expect(mocks.getInstructorPayrollSnapshot).toHaveBeenCalledWith(
      mocks.tx,
      "coach_a"
    );
    expect(mocks.tx.class.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instructorId: "coach_a",
        payrollRateSnapshot: "150.00",
        payrollRateEffectiveAt: new Date("2026-09-05T12:00:00.000Z"),
      }),
    });
  });

  it("uses the same snapshot for each generated recurrence", async () => {
    await POST(request({ ...validBody, repeatNextMonth: true }));

    const rows = mocks.tx.class.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(4);
    expect(rows.every((row: any) => row.payrollRateSnapshot === "150.00")).toBe(
      true
    );
  });

  it("blocks class creation when the instructor has no rate", async () => {
    mocks.getInstructorPayrollSnapshot.mockRejectedValueOnce(
      Object.assign(new Error("Configura una tarifa válida."), {
        code: "INSTRUCTOR_RATE_REQUIRED",
        status: 409,
      })
    );

    const response = await POST(request(validBody));

    expect(response.status).toBe(409);
    expect(mocks.tx.class.create).not.toHaveBeenCalled();
  });
});
