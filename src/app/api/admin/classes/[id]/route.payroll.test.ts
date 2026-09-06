import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    class: { findUnique: vi.fn() },
  };
  return {
    tx,
    requireAdminUser: vi.fn(),
    requireClassManagerUser: vi.fn(),
    updateClassWithPayrollAssignment: vi.fn(),
  };
});

vi.mock("../../_utils", () => ({
  requireAdminUser: mocks.requireAdminUser,
  requireClassManagerUser: mocks.requireClassManagerUser,
}));

vi.mock("@/lib/class-deletion-response", () => ({
  executeClassDeletion: vi.fn(),
}));

vi.mock("@/lib/payroll", () => ({
  runPayrollTransaction: (callback: (tx: typeof mocks.tx) => unknown) =>
    callback(mocks.tx),
  updateClassWithPayrollAssignment: mocks.updateClassWithPayrollAssignment,
  redactClassPayroll: (value: unknown) => value,
  payrollErrorResponse: (error: unknown) =>
    error instanceof Error && "status" in error
      ? {
          status: (error as Error & { status: number }).status,
          body: { error: (error as Error & { code?: string }).code },
        }
      : null,
}));

import { PATCH, PUT } from "./route";

function request(method: "PUT" | "PATCH", body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/classes/class_1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const ctx = { params: Promise.resolve({ id: "class_1" }) };

describe("class edit payroll assignment paths", () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({
      ok: true,
      user: { id: "admin_1", role: "ADMIN" },
    });
    mocks.requireClassManagerUser.mockResolvedValue({
      ok: true,
      user: { id: "coach_user", role: "COACH" },
    });
    mocks.tx.class.findUnique.mockResolvedValue({
      id: "class_1",
      date: new Date("2026-09-10T14:00:00.000Z"),
      deletedAt: null,
      bookings: [],
    });
    mocks.updateClassWithPayrollAssignment.mockResolvedValue({
      id: "class_1",
      instructor: { id: "coach_b", name: "Coach B" },
    });
  });

  it("routes admin-table reassignment through the centralized payroll service", async () => {
    const response = await PUT(
      request("PUT", { title: "Flow", instructorId: "coach_b" }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(mocks.updateClassWithPayrollAssignment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        classId: "class_1",
        instructorId: "coach_b",
        actorUserId: "admin_1",
      })
    );
  });

  it("routes calendar reassignment through the same service with the coach actor", async () => {
    const response = await PATCH(
      request("PATCH", { instructorId: "coach_b", time: "09:30" }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(mocks.updateClassWithPayrollAssignment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        classId: "class_1",
        instructorId: "coach_b",
        actorUserId: "coach_user",
        data: expect.objectContaining({ date: expect.any(Date) }),
      })
    );
  });

  it("surfaces a missing-rate conflict from calendar reassignment", async () => {
    mocks.updateClassWithPayrollAssignment.mockRejectedValueOnce(
      Object.assign(new Error("Tarifa requerida"), {
        code: "INSTRUCTOR_RATE_REQUIRED",
        status: 409,
      })
    );

    const response = await PATCH(
      request("PATCH", { instructorId: "coach_b" }),
      ctx
    );

    expect(response.status).toBe(409);
  });
});
