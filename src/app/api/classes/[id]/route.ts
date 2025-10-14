import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    // si tu requireAdmin necesita el Request, usa: await requireAdmin(_req);
    requireAdmin();

    const { id } = await ctx.params;   // 👈 importante: await
    await prisma.class.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const code =
      e?.code === "P2025" ? 404 :
      e?.message === "UNAUTHORIZED" ? 401 :
      e?.message === "FORBIDDEN" ? 403 : 500;

    return NextResponse.json({ error: e?.message || "ERROR" }, { status: code });
  }
}
