import { NextRequest, NextResponse } from "next/server";
import { prisma, getUserFromSession } from "../../../../../_utils";
import { revocationSchema, revokeAdminUnlimited, RevocationError } from "@/lib/admin-unlimited-revocation";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; purchaseId: string }> };
const reply = (status: number, body: object) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await getUserFromSession(req);
  if (!actor) return reply(401, { ok: false, code: "UNAUTHORIZED", message: "Inicia sesión para continuar." });
  if (actor.role !== "ADMIN") return reply(403, { ok: false, code: "FORBIDDEN", message: "Solo un administrador puede revocar paquetes ilimitados." });
  const body = revocationSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return reply(400, { ok: false, code: "INVALID_REVOCATION_REASON", message: "Escribe un motivo de revocación de hasta 1000 caracteres." });
  const { id: userId, purchaseId } = await ctx.params;
  try {
    const result = await prisma.$transaction(tx => revokeAdminUnlimited(tx, {
      userId, purchaseId, actorUserId: actor.id, reason: body.data.reason,
    }));
    return reply(200, { ok: true, alreadyRevoked: result.alreadyRevoked,
      message: result.alreadyRevoked ? "Este paquete ilimitado ya estaba revocado." : "Paquete ilimitado revocado correctamente. Las reservas existentes se conservan.",
      purchase: { id: result.purchase.id, revokedAt: result.purchase.revokedAt },
    });
  } catch (error) {
    if (error instanceof RevocationError)
      return reply(error.status, { ok: false, code: error.code, message: error.message });
    if (["P2034", "P2002", "P2010"].includes((error as { code?: string })?.code ?? ""))
      return reply(409, { ok: false, code: "REVOCATION_CONFLICT", message: "El paquete cambió durante la operación. Actualiza sus datos e intenta de nuevo." });
    return reply(500, { ok: false, code: "REVOCATION_FAILED", message: "No se pudo revocar el paquete. Intenta de nuevo." });
  }
}
