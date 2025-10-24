import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Tipar el contexto con params async (App Router)
type Ctx = { params: Promise<{ id: string }> };

function j(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const raw = await req.json();

  // Si viene "date" en string, conviértelo a Date
  const { date, ...rest } = raw ?? {};
  const data: any = { ...rest };
  if (date) data.date = new Date(date);

  const item = await prisma.class.update({
    where: { id },
    data,
  });

  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;

  // 1) Validación rápida: ¿hay dependencias?
  const [bookings, waiters] = await Promise.all([
    prisma.booking.count({ where: { classId: id, status: "ACTIVE" } }),
    prisma.waitlist.count({ where: { classId: id } }),
  ]);

  // Si quieres BLOQUEAR el borrado duro cuando existan dependencias,
  // descomenta este bloque para devolver 409 en lugar de intentar borrar:
  /*
  if (bookings > 0 || waiters > 0) {
    return j(409, {
      ok: false,
      code: "CLASS_HAS_DEPENDENCIES",
      message:
        "No se puede eliminar la clase porque tiene reservas o lista de espera. Cancélala (isCanceled=true) o elimina primero las dependencias.",
      details: { bookings, waitlist: waiters },
    });
  }
  */

  try {
    // 2) Intento de hard delete (si no hay dependencias, esto pasa sin problema)
    await prisma.class.delete({ where: { id } });
    return NextResponse.json({ ok: true, hardDeleted: true });
  } catch (e: unknown) {
    // 3) Si truena por FK, hacemos soft delete en su lugar
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2003" // Foreign key constraint failed
    ) {
      // Soft delete: marcar cancelada para que no aparezca como disponible
      const updated = await prisma.class.update({
        where: { id },
        data: { isCanceled: true },
      });

      return j(200, {
        ok: true,
        hardDeleted: false,
        softDeleted: true,
        reason: "FOREIGN_KEY_CONSTRAINT",
        message:
          "La clase tenía dependencias (reservas/lista de espera). Se marcó como cancelada (isCanceled=true).",
        class: { id: updated.id, isCanceled: updated.isCanceled },
        dependencies: { bookings, waitlist: waiters },
      });
    }

    // Otros errores: regresarlos con detalle para depurar sin 500 silencioso
    console.error("DELETE /classes/:id error", e);
    return j(500, {
      ok: false,
      code: "UNEXPECTED_ERROR",
      message: "No se pudo eliminar la clase.",
    });
  }
}
