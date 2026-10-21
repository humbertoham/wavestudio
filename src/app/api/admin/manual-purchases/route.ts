import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAssignmentSchema, assignmentKeySchema, assignAdminPackage, assignmentFailure } from "@/lib/admin-package-assignment";
import { prisma } from "@/lib/prisma";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

function j(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const me = await getAuth();
    if (!me) return j(401, { error: "UNAUTHORIZED", message: "Inicia sesión para asignar paquetes." });
    const actor = await prisma.user.findUnique({ where: { id: me.sub }, select: { role: true } });
    if (!actor || actor.role !== "ADMIN") return j(403, { error: "FORBIDDEN", message: "Solo un administrador puede asignar paquetes." });
    const body = adminAssignmentSchema.extend({ userId: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
    const key = assignmentKeySchema.safeParse(req.headers.get("Idempotency-Key"));
    if (!body.success || !key.success) return j(400, { error: "INVALID_ASSIGNMENT", message: "Selecciona un usuario y un paquete válidos." });
    const purchase = await prisma.$transaction(tx => assignAdminPackage(tx, {
      ...body.data, actorUserId: me.sub, requestKey: key.data, standardSale: true,
    }));
    return j(201, {
      ok: true,
      paymentId: purchase.paymentId,
      packPurchaseId: purchase.id,
      expiresAt: purchase.expiresAt,
      classesLeft: purchase.classesLeft,
      amount: purchase.paymentId ? purchase.priceSnapshot : 0,
    });
  } catch (error) {
    const failure = assignmentFailure(error);
    return j(failure.status, { error: failure.code, message: failure.message });
  }
}
