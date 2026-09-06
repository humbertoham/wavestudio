import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/app/api/admin/_utils";
import {
  currentPayrollMonth,
  getPayrollReport,
  payrollErrorResponse,
} from "@/lib/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ?? currentPayrollMonth();
    const report = await getPayrollReport(month);
    return NextResponse.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const known = payrollErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });

    console.error("PAYROLL_REPORT_ERROR", error);
    return NextResponse.json(
      {
        error: "PAYROLL_REPORT_FAILED",
        message: "No se pudo calcular la nómina.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
