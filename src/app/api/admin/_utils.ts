import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { jwtVerify } from "jose";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV === "development") globalForPrisma.prisma = prisma;

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function getUserFromSession(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub ? String(payload.sub) : null;
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });

    return user;
  } catch (err) {
    console.error("jwtVerify failed:", err);
    return null;
  }
}

// returns NextResponse if NOT admin, or null if ok
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
