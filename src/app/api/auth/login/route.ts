import { NextResponse } from "next/server";

import { compareHash } from "@/lib/hash";
import { signToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/zod";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();
  const rate = await consumeRateLimit(
    `login:${getClientIp(req)}:${normalizedEmail}`,
    {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    }
  );

  if (rate.limited) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      role: true,
      passwordHash: true,
    },
  });

  if (!user || !(await compareHash(password, user.passwordHash))) {
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const token = signToken({ sub: user.id, role: user.role });

  const res = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );

  res.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
