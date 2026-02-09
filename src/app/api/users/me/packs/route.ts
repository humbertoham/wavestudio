// src/app/api/users/me/packs/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  // 1️⃣ Auth
  const me = await getAuth();
  if (!me) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // 2️⃣ Últimos 5 paquetes comprados
  const rows = await prisma.packPurchase.findMany({
    where: {
      userId: me.sub,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 5,
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      classesLeft: true,
      pack: {
        select: {
          id: true,
          name: true,
          classes: true,
          price: true,
          classesLabel: true,
        },
      },
    },
  });

  // 3️⃣ Normalizar para el frontend (fechas ISO, defaults defensivos)
  const data = rows.map((p) => ({
    id: p.id,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    classesLeft: p.classesLeft,
    pack: {
      id: p.pack.id,
      name: p.pack.name,
      classes: p.pack.classes,
      price: p.pack.price,
      classesLabel: p.pack.classesLabel ?? null,
    },
  }));

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
