import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPayrollReport: vi.fn(),
}));

vi.mock("@/app/api/admin/_utils", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/payroll", () => ({
  currentPayrollMonth: () => "2026-09",
  getPayrollReport: mocks.getPayrollReport,
  payrollErrorResponse: () => null,
}));

import { GET } from "./route";

function request(query = "") {
  return new Request(
    `https://example.test/api/admin/accounting/payroll${query}`
  ) as any;
}

describe("GET /api/admin/accounting/payroll", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockResolvedValue(null);
    mocks.getPayrollReport.mockResolvedValue({
      month: "2026-09",
      summary: { total: "600.00" },
      instructors: [],
    });
  });

  it("allows an administrator and defaults to the current month", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getPayrollReport).toHaveBeenCalledWith("2026-09");
  });

  it("queries only the selected month", async () => {
    const response = await GET(request("?month=2026-08"));

    expect(response.status).toBe(200);
    expect(mocks.getPayrollReport).toHaveBeenCalledWith("2026-08");
  });

  it.each([
    ["COACH", 401],
    ["USER", 401],
    ["unauthenticated user", 401],
  ])("blocks direct access for %s", async (_label, status) => {
    mocks.requireAdmin.mockResolvedValueOnce(
      Response.json({ error: "UNAUTHORIZED" }, { status })
    );

    const response = await GET(request());

    expect(response.status).toBe(status);
    expect(mocks.getPayrollReport).not.toHaveBeenCalled();
  });
});
