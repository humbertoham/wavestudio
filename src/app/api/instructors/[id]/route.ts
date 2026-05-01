import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    await requireAdmin(req);

    const { id } = await ctx.params;
    await prisma.instructor.update({
      where: { id },
      data: { isVisible: false },
    });

    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025"
        ? 404
        : error instanceof Error && error.message === "UNAUTHORIZED"
          ? 401
          : error instanceof Error && error.message === "FORBIDDEN"
            ? 403
            : 500;

    const message =
      error instanceof Error && error.message
        ? error.message
        : code === 404
          ? "NOT_FOUND"
          : "ERROR";

    return NextResponse.json({ error: message }, { status: code });
  }
}
