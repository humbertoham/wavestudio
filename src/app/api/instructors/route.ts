import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { instructorCreateSchema } from "@/lib/zod";
import { requireAdmin } from "@/lib/auth";
import {
  createInstructorWithRate,
  payrollErrorResponse,
} from "@/lib/payroll";

export const runtime = "nodejs";

export async function GET() {
  const list = await prisma.instructor.findMany({
    where: { isVisible: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      bio: true,
      createdAt: true,
      isVisible: true,
    },
  });
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  try {
    const actor = await requireAdmin(req);
    const body = await req.json();
    const parsed = instructorCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });

    const ins = await createInstructorWithRate({
      ...parsed.data,
      actorUserId: String(actor.sub),
    });
    return NextResponse.json(ins, { status: 201 });
  } catch (e: any) {
    const known = payrollErrorResponse(e);
    if (known) return NextResponse.json(known.body, { status: known.status });
    const code = e.message === "UNAUTHORIZED" ? 401 : e.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: e.message }, { status: code });
  }
}
