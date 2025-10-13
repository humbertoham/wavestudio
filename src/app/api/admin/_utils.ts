import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { jwtVerify } from "jose";

export const runtime = "nodejs"; // ← asegúrate que NO sea Edge
export const prisma = new PrismaClient();

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function getUserFromSession(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  if (!token) return null;
  try {
    // Tu login firma con { sub: user.id, role: user.role }
    const { payload } = await jwtVerify(token, secret); // HS256 por defecto si así firmaste
    const userId = String(payload.sub); // ← OJO: usar 'sub'
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
    return user;
  } catch {
    return null;
  }
}

export async function requireAdmin(req: NextRequest) {
  const user = await getUserFromSession(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  return null as NextResponse | null;
}
