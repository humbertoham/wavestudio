import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";

export const runtime = "nodejs";

// Tipar el contexto con params async:
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req); 
  if (auth) return auth;

  const { id } = await ctx.params;           // 👈 importante
  const { date, ...rest } = await req.json();

  const item = await prisma.class.update({
    where: { id },
    data: { ...(date ? { date: new Date(date) } : {}), ...rest },
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req); 
  if (auth) return auth;

  const { id } = await ctx.params;           // 👈 importante
  await prisma.class.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
