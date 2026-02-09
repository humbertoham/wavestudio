// src/app/api/packs/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

type ApiPack = {
  id: string;
  name: string;
  classesLabel?: string | null;
  classesCount?: number | null;
  price: number;
  validity?: string | null;
  validityDays?: number | null;
  highlight?: "popular" | "best" | null;
  description?: string[] | null;
  oncePerUser?: boolean;
};

function toStringArray(json: Prisma.JsonValue | null): string[] | null {
  if (json == null) return null;
  if (Array.isArray(json)) return json.map((x) => String(x));
  if (typeof json === "string")
    return json
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  return null;
}

export async function GET() {
  try {
    const rows = await prisma.pack.findMany({
      where: { isActive: true },
      orderBy: [{ highlight: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        classes: true,
        price: true,
        validityDays: true,
        classesLabel: true,
        highlight: true,
        description: true,
        oncePerUser: true, // ✅
      },
    });

    const data: ApiPack[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      classesLabel:
        p.classesLabel ??
        (typeof p.classes === "number"
          ? `${p.classes} ${p.classes === 1 ? "clase" : "clases"}`
          : null),
      classesCount: typeof p.classes === "number" ? p.classes : null,
      price: p.price,
      validity:
        typeof p.validityDays === "number"
          ? `Vigencia de ${p.validityDays} días`
          : null,
      validityDays: p.validityDays ?? null,
      highlight: (p.highlight as unknown as "popular" | "best" | null) ?? null,
      description: toStringArray(p.description),
      oncePerUser: p.oncePerUser,
    }));

    return NextResponse.json(data);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "FAILED" }, { status: 500 });
  }
}
