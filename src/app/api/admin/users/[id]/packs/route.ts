import { NextRequest, NextResponse } from "next/server";
import { prisma, getUserFromSession } from "../../../_utils";
import { adminAssignmentSchema, assignmentKeySchema, assignAdminPackage, assignmentFailure } from "@/lib/admin-package-assignment";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await getUserFromSession(req);
  if (!actor) return NextResponse.json({ ok: false, message: "Inicia sesión para asignar paquetes." }, { status: 401 });
  if (actor.role !== "ADMIN") return NextResponse.json({ ok: false, message: "Solo un administrador puede asignar paquetes." }, { status: 403 });
  const body = adminAssignmentSchema.safeParse(await req.json().catch(() => null));
  const key = assignmentKeySchema.safeParse(req.headers.get("Idempotency-Key"));
  if (!body.success || !key.success)
    return NextResponse.json({ ok: false, message: "Selecciona un paquete válido y reintenta la asignación." }, { status: 400 });
  const { id: userId } = await ctx.params;
  try {
    const purchase = await prisma.$transaction(tx => assignAdminPackage(tx, {
      userId, ...body.data, actorUserId: actor.id, requestKey: key.data,
    }));
    return NextResponse.json({ ok: true, message: "Paquete asignado correctamente.", purchase: {
      id: purchase.id, packId: purchase.packId, packName: purchase.nameSnapshot,
      type: purchase.type, classes: purchase.classesLeft,
      unlimitedMonth: purchase.unlimitedMonth, unlimitedYear: purchase.unlimitedYear,
      expiresAt: purchase.expiresAt,
    } });
  } catch (error) {
    const failure = assignmentFailure(error);
    return NextResponse.json({ ok: false, code: failure.code, message: failure.message }, { status: failure.status });
  }
}
