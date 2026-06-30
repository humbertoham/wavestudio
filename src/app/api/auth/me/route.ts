import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const auth = await requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        affiliation: true,
        wellhubPlan: true,
        affiliationConfirmedAt: true,
      },
    });

    if (!user) return NextResponse.json(null);

    const affiliationConfirmed = user.affiliationConfirmedAt != null;
    const res = NextResponse.json({
      ...user,
      affiliationConfirmed,
    });

    if (
      auth.affiliationConfirmed !== affiliationConfirmed ||
      auth.role !== user.role
    ) {
      res.cookies.set(
        "session",
        signToken({
          sub: user.id,
          role: user.role,
          affiliationConfirmed,
        }),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        }
      );
    }

    return res;
  } catch (e: any) {
    const code = e?.message === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "ERROR" }, { status: code });
  }
}
