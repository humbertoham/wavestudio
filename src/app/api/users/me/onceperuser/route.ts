import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const me = await getAuth();

  if (!me) {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  // Traemos solo los packId que:
  // 1️⃣ ya compró el usuario
  // 2️⃣ el pack tiene oncePerUser = true
  const purchases = await prisma.packPurchase.findMany({
    where: {
      userId: me.sub,
      pack: {
        oncePerUser: true,
      },
    },
    select: {
      packId: true,
    },
  });

  // Convertimos a array simple de ids
  const packIds = purchases.map(p => p.packId);

  return NextResponse.json(packIds, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}