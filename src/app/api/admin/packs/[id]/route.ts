import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";
import { packConfigurationSchema } from "@/lib/package-config";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

/* -------------------------
   Helpers
------------------------- */

const packUpdateSchema = packConfigurationSchema;

/* -------------------------
   Context (Next App Router)
------------------------- */

type Ctx = { params: Promise<{ id: string }> };

/* -------------------------
   PATCH /admin/packs/[id]
------------------------- */

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await ctx.params;

    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    const existing = await prisma.pack.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    const parsed = packUpdateSchema.safeParse({ ...existing, ...raw, description: raw.description, classes: raw.classes ?? raw.classesCount ?? existing.classes });

    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" | ");
      return NextResponse.json(
        { error: `INVALID: ${msg}` },
        { status: 400 }
      );
    }

    // Validate the complete configuration, but preserve PATCH's partial-write
    // semantics so unrelated fields and legacy JSON descriptions stay intact.
    const data = parsed.data as Record<string, unknown>;
    const requested = new Set(Object.keys(raw));
    if (requested.has("classesCount")) requested.add("classes");
    if (requested.has("type")) for (const key of ["classes", "validityDays", "unlimitedMonth", "unlimitedYear"]) requested.add(key);
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (requested.has(k) && v !== undefined && !(k === "description" && raw.description == null)) clean[k] = v;
    }

    const updated = await prisma.pack.update({
      where: { id },
      data: clean,
    });

    return NextResponse.json(
      { item: updated },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED")
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    if (e?.message === "FORBIDDEN")
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002")
        return NextResponse.json(
          { error: "CONFLICT: nombre duplicado" },
          { status: 409 }
        );
      if (e.code === "P2025")
        return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
      return NextResponse.json(
        { error: `PRISMA_${e.code}` },
        { status: 500 }
      );
    }

    console.error("PACK_PATCH_ERROR", e);
    return NextResponse.json(
      { error: e?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}

/* -------------------------
   DELETE /admin/packs/[id]
------------------------- */

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  try {
    const { id } = await ctx.params;

    // Validación básica
    if (!id) {
      return NextResponse.json(
        { error: "INVALID_ID" },
        { status: 400 }
      );
    }

    // Soft delete
    const updated = await prisma.pack.update({
      where: { id },
      data: { isVisible: false, isActive: false },
    });

    return NextResponse.json(
      { ok: true, item: updated },
      { headers: { "Cache-Control": "no-store" } }
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
      // No encontrado
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

    console.error("PACK_DELETE_ERROR", e);

    return NextResponse.json(
      { error: e?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
