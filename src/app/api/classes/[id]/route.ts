import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    requireAdmin();
    const { id } = ctx.params;
    await prisma.class.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const code =
      e.code === "P2025" ? 404 :
      e.message === "UNAUTHORIZED" ? 401 :
      e.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: e.message || "ERROR" }, { status: code });
  }
}
