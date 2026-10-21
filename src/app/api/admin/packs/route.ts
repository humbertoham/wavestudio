import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import { packConfigurationSchema } from "@/lib/package-config";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/* -------------------------
   Helpers
------------------------- */

const packCreateSchema = packConfigurationSchema;

/* -------------------------
   GET /admin/packs
------------------------- */

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const items = await prisma.pack.findMany({
      where: { isVisible: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("PACKS_GET_ERROR", e);
    return NextResponse.json(
      { error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

/* -------------------------
   POST /admin/packs
------------------------- */

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const raw = await req.json();
    const parsed = packCreateSchema.safeParse(raw);

    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" | ");

      return NextResponse.json(
        { error: `INVALID: ${msg}` },
        { status: 400 }
      );
    }

    const {
      type, unlimitedMonth, unlimitedYear, isVisible,
      name,
      classes,
      price,
      validityDays,
      isActive,
      oncePerUser,
      classesLabel,
      highlight,
      description,
    } = parsed.data;

    const created = await prisma.pack.create({
      data: {
        type, unlimitedMonth, unlimitedYear, isVisible,
        name,
        classes,
        price,
        validityDays,
        isActive,
        oncePerUser, // ✅ guardado
        classesLabel: classesLabel ?? null,
        highlight: highlight ?? null,
        description: description ?? [],
      },
    });

    return NextResponse.json(
      { item: created },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED")
      return NextResponse.json(
        { error: "UNAUTHORIZED" },
        { status: 401 }
      );

    if (e?.message === "FORBIDDEN")
      return NextResponse.json(
        { error: "FORBIDDEN" },
        { status: 403 }
      );

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002")
        return NextResponse.json(
          { error: "CONFLICT: nombre duplicado" },
          { status: 409 }
        );
      if (e.code === "P2003")
        return NextResponse.json(
          { error: "FOREIGN_KEY: referencia inválida" },
          { status: 400 }
        );
      if (e.code === "P2025")
        return NextResponse.json(
          { error: "NOT_FOUND" },
          { status: 404 }
        );

      return NextResponse.json(
        { error: `PRISMA_${e.code}` },
        { status: 500 }
      );
    }

    console.error("PACKS_POST_ERROR", e);
    return NextResponse.json(
      { error: e?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
