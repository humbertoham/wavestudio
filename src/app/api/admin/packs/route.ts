import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";
import { z } from "zod";
import { Prisma, PackHighlight } from "@prisma/client";

export const runtime = "nodejs";

/* -------------------------
   Helpers
------------------------- */

function normalizeDescription(input: unknown): string[] | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input))
    return input
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  if (typeof input === "string")
    return input
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  return undefined;
}

// acepta "popular" | "best" (minúsculas) o enum; convierte a enum
const highlightSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.nativeEnum(PackHighlight).nullable().optional()
);

/* -------------------------
   Zod schema
------------------------- */

const packCreateSchema = z
  .object({
    name: z.string().min(1, "name requerido"),

    classes: z.coerce.number().int().positive().optional(),
    classesCount: z.coerce.number().int().positive().optional(),

    price: z
      .coerce
      .number()
      .nonnegative("price inválido")
      .transform((v) => Math.round(v)),

    validityDays: z
      .coerce
      .number()
      .int()
      .positive("validityDays debe ser > 0"),

    isActive: z.coerce.boolean().default(true),

    // ✅ NUEVO
    oncePerUser: z.coerce.boolean().default(false),

    classesLabel: z.string().trim().min(1).optional(),
    highlight: highlightSchema,
    description: z.any().optional(),
  })
  .refine(
    (v) =>
      typeof v.classes === "number" ||
      typeof v.classesCount === "number",
    {
      message: "Debes enviar classes o classesCount",
      path: ["classesCount"],
    }
  )
  .transform((v) => ({
    ...v,
    classes: (v.classes ?? v.classesCount) as number,
    description: normalizeDescription(v.description),
  }));

/* -------------------------
   GET /admin/packs
------------------------- */

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const items = await prisma.pack.findMany({
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
