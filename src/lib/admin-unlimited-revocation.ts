import type { Prisma } from "@prisma/client";
import { z } from "zod";

export const revocationSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
}).strict();

export class RevocationError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

/** Admin removal is deliberately separate from payment reversal/cancellation. */
export async function revokeAdminUnlimited(
  tx: Prisma.TransactionClient,
  params: { userId: string; purchaseId: string; actorUserId: string; reason: string },
) {
  const parsed = revocationSchema.safeParse({ reason: params.reason });
  if (!parsed.success)
    throw new RevocationError("INVALID_REVOCATION_REASON", 400, "Escribe un motivo de revocación de hasta 1000 caracteres.");
  const actor = await tx.user.findUnique({ where: { id: params.actorUserId }, select: { role: true } });
  if (actor?.role !== "ADMIN")
    throw new RevocationError("FORBIDDEN", 403, "Solo un administrador puede revocar paquetes ilimitados.");

  // Same row lock as the final booking check. Under READ COMMITTED, a waiter
  // reads the committed revocation; SERIALIZABLE bookings retry a stale snapshot.
  await tx.$queryRaw`
    SELECT "id" FROM "PackPurchase"
    WHERE "id" = ${params.purchaseId} AND "userId" = ${params.userId}
    FOR UPDATE
  `;
  const purchase = await tx.packPurchase.findFirst({
    where: { id: params.purchaseId, userId: params.userId },
  });
  if (!purchase)
    throw new RevocationError("ENTITLEMENT_NOT_FOUND", 404, "No se encontró este paquete para el usuario seleccionado.");
  if (purchase.type !== "MONTHLY_UNLIMITED")
    throw new RevocationError("NOT_UNLIMITED_ENTITLEMENT", 409, "Esta acción solo está disponible para paquetes ilimitados mensuales.");
  if (purchase.revokedAt) return { purchase, alreadyRevoked: true };
  const now = new Date();
  if (purchase.expiresAt <= now)
    throw new RevocationError("UNLIMITED_NOT_ACTIVE", 409, "Este paquete ilimitado ya finalizó.");

  const updated = await tx.packPurchase.update({
    where: { id: purchase.id },
    data: { revokedAt: now, revocationReason: parsed.data.reason },
  });
  // Existing audit mechanism: zero delta never grants or refunds credits.
  // The immutable entry survives later provider reversals of the same purchase.
  await tx.tokenLedger.create({ data: {
    userId: params.userId, packPurchaseId: purchase.id,
    delta: 0, reason: "ADMIN_ADJUST",
    idempotencyKey: `admin-unlimited-revocation:${purchase.id}`,
    metadata: { source: "ADMIN", action: "UNLIMITED_REVOCATION",
      actorUserId: params.actorUserId, reason: parsed.data.reason,
      revokedAt: now.toISOString() },
  } });
  return { purchase: updated, alreadyRevoked: false };
}
