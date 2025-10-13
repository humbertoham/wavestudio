import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req); 
  if (auth) return auth;

  const { id } = await ctx.params;           // 👈 ahora await
  const patch = await req.json();

  const item = await prisma.instructor.update({
    where: { id },
    data: patch,
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req); 
  if (auth) return auth;

  const { id } = await ctx.params;           // 👈 ahora await
  await prisma.instructor.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
