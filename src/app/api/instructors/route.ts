import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { instructorCreateSchema } from "@/lib/zod";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const list = await prisma.instructor.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  try {
    requireAdmin();
    const body = await req.json();
    const parsed = instructorCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });

    const ins = await prisma.instructor.create({ data: parsed.data });
    return NextResponse.json(ins, { status: 201 });
  } catch (e: any) {
    const code = e.message === "UNAUTHORIZED" ? 401 : e.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: e.message }, { status: code });
  }
}
