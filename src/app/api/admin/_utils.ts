import { NextRequest, NextResponse } from "next/server";
import { PrismaClient, Role } from "@prisma/client";
import { jwtVerify } from "jose";

// -----------------------
// PRISMA (avoid hot-reload leak)
// -----------------------
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV === "development") globalForPrisma.prisma = prisma;

// -----------------------
// JWT SECRET
// -----------------------
const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

// -----------------------
// Get Session User
// -----------------------
export async function getUserFromSession(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);

    const userId = payload.sub ? String(payload.sub) : null;
    if (!userId) return null;

    return await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
  } catch (err) {
    console.error("jwtVerify failed:", err);
    return null;
  }
}

// -----------------------
// Admin Guard
// -----------------------
export async function requireAdmin(req: NextRequest) {
  const user = await getUserFromSession(req);

  if (!user || user.role !== Role.ADMIN) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "UNAUTHORIZED" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return { ok: true, user };
}
