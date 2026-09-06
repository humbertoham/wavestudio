import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin, requireAdminUser } from "../../_utils";
import { Prisma } from "@prisma/client";
import {
  payrollErrorResponse,
  updateInstructorWithRate,
} from "@/lib/payroll";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/* ========================
   UPDATE Instructor
======================== */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const patch = await req.json();

    const item = await updateInstructorWithRate({
      instructorId: id,
      name: patch?.name,
      payrollRate: patch?.payrollRate,
      actorUserId: auth.user.id,
    });

    return NextResponse.json(item, {
      headers: { "Cache-Control": "no-store" },
    });

  } catch (e: any) {
    const known = payrollErrorResponse(e);
    if (known) return NextResponse.json(known.body, { status: known.status });

    if (e?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    if (e?.message === "FORBIDDEN")
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

      return NextResponse.json(
        { error: `PRISMA_${e.code}` },
        { status: 500 }
      );
    }

    console.error("INSTRUCTOR_PUT_ERROR", e);
    return NextResponse.json(
      { error: e?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

/* ========================
   SOFT DELETE Instructor
======================== */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await ctx.params;

    await prisma.instructor.update({
      where: { id },
      data: { isVisible: false },
    });

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );

  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    if (e?.message === "FORBIDDEN")
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

      return NextResponse.json(
        { error: `PRISMA_${e.code}` },
        { status: 500 }
      );
    }

    console.error("INSTRUCTOR_DELETE_ERROR", e);
    return NextResponse.json(
      { error: e?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
