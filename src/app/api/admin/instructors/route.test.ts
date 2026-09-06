import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  requireClassManagerUser: vi.fn(),
  createInstructorWithRate: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../_utils", () => ({
  requireAdminUser: mocks.requireAdminUser,
  requireClassManagerUser: mocks.requireClassManagerUser,
  prisma: { instructor: { findMany: mocks.findMany } },
}));

vi.mock("@/lib/payroll", () => ({
  createInstructorWithRate: mocks.createInstructorWithRate,
  payrollErrorResponse: (error: unknown) =>
    error instanceof Error && "status" in error
      ? {
          status: (error as Error & { status: number }).status,
          body: { error: error.message },
        }
      : null,
}));

import { GET, POST } from "./route";

const admin = { id: "admin_1", role: "ADMIN" };

function request(method = "GET", body?: unknown) {
  return new Request("https://example.test/api/admin/instructors", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  }) as any;
}

describe("admin instructor payroll rates", () => {
  beforeEach(() => {
    mocks.requireAdminUser.mockResolvedValue({ ok: true, user: admin });
    mocks.requireClassManagerUser.mockResolvedValue({ ok: true, user: admin });
    mocks.findMany.mockResolvedValue([]);
    mocks.createInstructorWithRate.mockResolvedValue({
      id: "coach_a",
      name: "Coach A",
      payrollRate: "150.00",
    });
  });

  it("lets an admin create an instructor with a valid rate", async () => {
    const response = await POST(
      request("POST", { name: "Coach A", payrollRate: "150.00" })
    );

    expect(response.status).toBe(201);
    expect(mocks.createInstructorWithRate).toHaveBeenCalledWith({
      name: "Coach A",
      bio: undefined,
      payrollRate: "150.00",
      actorUserId: "admin_1",
    });
  });

  it.each(["COACH", "USER"])("does not let a %s modify rates", async (role) => {
    mocks.requireAdminUser.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }),
    });

    const response = await POST(
      request("POST", { name: "Coach A", payrollRate: "150.00", role })
    );

    expect(response.status).toBe(401);
    expect(mocks.createInstructorWithRate).not.toHaveBeenCalled();
  });

  it("does not expose rates in the coach instructor list", async () => {
    mocks.requireClassManagerUser.mockResolvedValueOnce({
      ok: true,
      user: { id: "coach_user", role: "COACH" },
    });

    await GET(request());

    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty(
      "payrollRate"
    );
  });

  it("includes rates for the admin instructor management screen", async () => {
    await GET(request());

    expect(mocks.findMany.mock.calls[0][0].select.payrollRate).toBe(true);
  });
});
