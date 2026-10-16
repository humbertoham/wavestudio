import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { grantPackagePurchase, packageSnapshot } from "@/lib/monthly-unlimited";
import { assertNoMonthlyDuplicate } from "@/lib/package-checkout";

export const adminAssignmentSchema = z.object({
  packId: z.string().trim().min(1).max(200),
  note: z.string().max(1000).nullish(),
});
export const assignmentKeySchema = z.string().uuid().nullable();

export class AssignmentError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

/** Uses the existing entitlement model. A zero-delta ADMIN_ADJUST is audit only. */
export async function assignAdminPackage(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    packId: string;
    actorUserId: string;
    requestKey: string | null;
    note?: string | null;
    standardSale?: boolean;
  },
) {
  const { userId, packId, actorUserId } = params;
  const idempotencyKey = `admin-package-assignment:${params.requestKey ?? randomUUID()}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-package-assignment:${userId}`}))`;
  const previous = await tx.tokenLedger.findUnique({
    where: { idempotencyKey }, include: { packPurchase: true },
  });
  if (previous) {
    const metadata = previous.metadata as Prisma.JsonObject | null;
    if (previous.userId !== userId || metadata?.packId !== packId || metadata?.actorUserId !== actorUserId || !previous.packPurchase)
      throw new AssignmentError("ASSIGNMENT_KEY_CONFLICT", 409, "Esta solicitud ya se usó para otra asignación. Recarga la página e inténtalo de nuevo.");
    return previous.packPurchase;
  }
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AssignmentError("USER_NOT_FOUND", 404, "Usuario no encontrado. Selecciona una cuenta existente.");
  const pack = await tx.pack.findUnique({ where: { id: packId } });
  if (!pack) throw new AssignmentError("PACK_NOT_FOUND", 404, "Paquete no encontrado. Actualiza la lista de paquetes.");
  const snapshot = packageSnapshot(pack);
  await assertNoMonthlyDuplicate(tx, userId, snapshot);

  // Preserve existing standard manual sales. An unlimited grant has no payment.
  const payment = snapshot.type === "STANDARD" ? await tx.payment.create({ data: {
    provider: params.standardSale ? "MERCADOPAGO" : "ADMIN",
    status: "APPROVED", amount: pack.price, currency: "MXN", userId,
    packSnapshot: snapshot,
    ...(params.standardSale ? {
      mpExternalRef: "ADMIN_MANUAL",
      mpRaw: { source: "admin_manual", note: params.note ?? null, packId, userId },
    } : {}),
  } }) : null;
  const purchase = await grantPackagePurchase(tx, {
    userId, packId, snapshot, ...(payment ? { paymentId: payment.id } : {}),
  });
  await tx.tokenLedger.create({ data: {
    userId, packPurchaseId: purchase.id, delta: 0, reason: "ADMIN_ADJUST", idempotencyKey,
    metadata: { source: "ADMIN", action: "PACKAGE_ASSIGNMENT", actorUserId, packId,
      snapshot, note: params.note ?? null },
  } });
  return purchase;
}

export function assignmentFailure(error: unknown) {
  if (error instanceof AssignmentError)
    return { status: error.status, code: error.code, message: error.message };
  const code = (error as { code?: string })?.code;
  if (code === "UNLIMITED_MONTH_ALREADY_PURCHASED")
    return { status: 409, code, message: "El usuario ya tiene un ilimitado para ese mes o un checkout pendiente. Revisa sus paquetes y pagos antes de reintentar." };
  if (code === "UNLIMITED_NOT_ACTIVE")
    return { status: 409, code, message: "El mes de este paquete ya terminó. Selecciona un paquete del mes actual o de un mes futuro." };
  if (code === "P2002" || code === "P2034")
    return { status: 409, code: "ASSIGNMENT_CONFLICT", message: "Hay otra asignación en curso. Revisa los paquetes del usuario y reintenta con la misma solicitud." };
  if (code === "P2021" || code === "P2022")
    return { status: 503, code: "ASSIGNMENT_SCHEMA_UNAVAILABLE", message: "La base de datos necesita las migraciones de paquetes. Solicita al equipo técnico revisar este entorno." };
  return { status: 500, code: "ASSIGNMENT_FAILED", message: "No se pudo asignar el paquete. No se guardó la asignación. Reintenta y, si persiste, contacta al equipo técnico." };
}
