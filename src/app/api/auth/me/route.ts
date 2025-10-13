import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { sub } = await requireAuth(); // 👈 AQUI va el await
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, name: true, email: true, role: true },
    });
    return NextResponse.json(user);
  } catch (e: any) {
    const code = e?.message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "ERROR" }, { status: code });
  }
}
