import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { class: { create: vi.fn() } };
  return {
    tx,
    requireAdmin: vi.fn(),
    getInstructorPayrollSnapshot: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuth: vi.fn(),
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/prisma", () => ({ prisma: { class: { findMany: vi.fn() } } }));

vi.mock("@/lib/challenge", () => ({
  getClassChallengeSnapshot: vi.fn().mockResolvedValue({}),
  runChallengeTransaction: (callback: (tx: typeof mocks.tx) => unknown) =>
    callback(mocks.tx),
}));

vi.mock("@/lib/payroll", () => ({
  getInstructorPayrollSnapshot: mocks.getInstructorPayrollSnapshot,
  payrollErrorResponse: (error: unknown) =>
    error instanceof Error && "status" in error
      ? {
          status: (error as Error & { status: number }).status,
          body: { error: (error as Error & { code?: string }).code },
        }
      : null,
}));

import { POST } from "./route";

function request() {
  return new Request("https://example.test/api/classes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Flow",
      focus: "Yoga",
      date: "2026-09-10T14:00:00.000Z",
      durationMin: 60,
      capacity: 12,
      instructorId: "coach_a",
    }),
  });
}

describe("POST /api/classes payroll snapshot", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue({ sub: "admin_1", role: "ADMIN" });
    mocks.getInstructorPayrollSnapshot.mockResolvedValue({
      payrollRateSnapshot: "180.00",
      payrollRateEffectiveAt: new Date("2026-09-05T12:00:00.000Z"),
    });
    mocks.tx.class.create.mockResolvedValue({ id: "class_1" });
  });

  it("enforces and stores a payroll snapshot on the compatibility create route", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.tx.class.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        instructorId: "coach_a",
        payrollRateSnapshot: "180.00",
      }),
    });
  });

  it("returns a clear conflict instead of creating without a rate", async () => {
    mocks.getInstructorPayrollSnapshot.mockRejectedValueOnce(
      Object.assign(new Error("Tarifa requerida"), {
        code: "INSTRUCTOR_RATE_REQUIRED",
        status: 409,
      })
    );

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.tx.class.create).not.toHaveBeenCalled();
  });
});
