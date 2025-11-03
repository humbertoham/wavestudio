import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";
import { z } from "zod";
import { Prisma, PackHighlight } from "@prisma/client";

export const runtime = "nodejs";

function normalizeDescription(input: unknown): string[] | undefined {
  if (input == null) return undefined;
  if (Array.isArray(input)) return input.map(v => typeof v === "string" ? v.trim() : "").filter(Boolean);
  if (typeof input === "string") return input.split("\n").map(s => s.trim()).filter(Boolean);
  return undefined;
}

const highlightSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  z.nativeEnum(PackHighlight).nullable().optional()
);

const packUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  classes: z.coerce.number().int().positive().optional(),
  classesCount: z.coerce.number().int().positive().optional(),
  price: z.coerce.number().nonnegative("price inválido").transform(v => Math.round(v)).optional(),
  validityDays: z.coerce.number().int().positive().optional(),
  isActive: z.coerce.boolean().optional(),
  classesLabel: z.string().trim().min(1).nullable().optional(),
  highlight: highlightSchema,
  description: z.any().optional(),
}).transform(v => ({
  ...v,
  classes: typeof v.classes === "number" ? v.classes : (v.classesCount as number | undefined),
  description: normalizeDescription(v.description),
}));

// 👇 Contexto esperado por tu Next: params es Promise
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await ctx.params;           // 👈 await
    const raw = await req.json();
    const parsed = packUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" | ");
      return NextResponse.json({ error: `INVALID: ${msg}` }, { status: 400 });
    }

    const { classesCount: _drop, ...data } = parsed.data as Record<string, unknown>;
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = v;

    const updated = await prisma.pack.update({ where: { id }, data: clean });
    return NextResponse.json({ item: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (e?.message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") return NextResponse.json({ error: "CONFLICT: nombre duplicado" }, { status: 409 });
      if (e.code === "P2025") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ error: `PRISMA_${e.code}` }, { status: 500 });
    }

    console.error("PACK_PATCH_ERROR", e);
    return NextResponse.json({ error: e?.message ?? "SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await ctx.params;           // 👈 await
    await prisma.pack.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (e?.message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      if (e.code === "P2003") return NextResponse.json({ error: "FOREIGN_KEY: referencia inválida" }, { status: 400 });
      return NextResponse.json({ error: `PRISMA_${e.code}` }, { status: 500 });
    }

    console.error("PACK_DELETE_ERROR", e);
    return NextResponse.json({ error: e?.message ?? "SERVER_ERROR" }, { status: 500 });
  }
}
