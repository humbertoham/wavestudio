import { NextResponse } from "next/server";

import { hash } from "@/lib/hash";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      token?: unknown;
      password?: unknown;
    } | null;

    const token =
      typeof body?.token === "string" ? body.token.trim() : "";
    const password =
      typeof body?.password === "string" ? body.password : "";

    if (!token || password.length < 8) {
      return NextResponse.json({ error: "INVALID" }, { status: 400 });
    }

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
      },
    });

    if (!resetToken) {
      return NextResponse.json({ error: "TOKEN_INVALID" }, { status: 400 });
    }

    if (resetToken.expiresAt < new Date()) {
      await prisma.passwordResetToken
        .delete({ where: { id: resetToken.id } })
        .catch(() => null);

      return NextResponse.json({ error: "TOKEN_INVALID" }, { status: 400 });
    }

    const passwordHash = await hash(password);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("RESET_PASSWORD_ERROR", error);
    return NextResponse.json({ error: "ERROR" }, { status: 500 });
  }
}
