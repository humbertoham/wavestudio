// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/zod";
import { compareHash } from "@/lib/hash";
import { signToken } from "@/lib/jwt";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !(await compareHash(password, user.passwordHash)))
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });

  // Debe firmar con { sub, role }
  const token = signToken({ sub: user.id, role: user.role });

  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // en dev => false
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
