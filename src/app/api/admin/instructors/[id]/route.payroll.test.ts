import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  updateInstructorWithRate: vi.fn(),
}));

vi.mock("../../_utils", () => ({
  prisma: {},
  requireAdmin: vi.fn(),
  requireAdminUser: mocks.requireAdminUser,
}));

vi.mock("@/lib/payroll", () => ({
  updateInstructorWithRate: mocks.updateInstructorWithRate,
  payrollErrorResponse: () => null,
}));

import { PUT } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("https://example.test/api/admin/instructors/coach_a", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const ctx = { params: Promise.resolve({ id: "coach_a" }) };

describe("PUT /api/admin/instructors/[id] payroll rate", () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({
      ok: true,
      user: { id: "admin_1", role: "ADMIN" },
    });
    mocks.updateInstructorWithRate.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: "180.00",
    });
  });

  it("allows an admin to update a valid instructor rate", async () => {
    const response = await PUT(
      request({ name: "Coach A", payrollRate: "180.00" }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(mocks.updateInstructorWithRate).toHaveBeenCalledWith({
      instructorId: "coach_a",
      name: "Coach A",
      payrollRate: "180.00",
      actorUserId: "admin_1",
    });
  });

  it.each(["COACH", "USER"])("blocks a %s from updating a rate", async () => {
    mocks.requireAdminUser.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    });

    const response = await PUT(
      request({ name: "Coach A", payrollRate: "180.00" }),
      ctx
    );

    expect(response.status).toBe(401);
    expect(mocks.updateInstructorWithRate).not.toHaveBeenCalled();
  });
});
