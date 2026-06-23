import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";

import { getAuthFromRequest } from "@/lib/auth";
import { prisma as sharedPrisma } from "@/lib/prisma";

export const prisma = sharedPrisma;

export async function getUserFromSession(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const userId = auth?.sub ? String(auth.sub) : null;
  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
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

// Class detail management is shared by admins and coaches. Broader admin routes
// should keep using requireAdmin so coaches cannot access the admin panel APIs.
export async function requireClassManager(req: NextRequest) {
  const user = await getUserFromSession(req);

  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Inicia sesión para continuar." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (user.role !== Role.ADMIN && user.role !== Role.COACH) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "No tienes permiso para administrar esta clase." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  return null as NextResponse | null;
}
