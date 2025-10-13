import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/zod";
import { hash } from "@/lib/hash";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });

  const { name, email, password } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });

  const passwordHash = await hash(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
}
