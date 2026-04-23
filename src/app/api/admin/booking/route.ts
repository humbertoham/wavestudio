import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const BOOKING_BLOCKED_MESSAGE =
  "Hola, debido a nuestras politicas de cancelacion, tus creditos estan bloqueados por una cancelacion tardia o falta a clase. Para desbloquearlos, es necesario liquidar el monto de $100. Contactanos por DM para realizar el pago.";

const bodySchema = z.object({
  userId: z.string().min(1),
  classId: z.string().min(1),
});

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function methodNotAllowed() {
  return json(405, { error: "METHOD_NOT_ALLOWED" });
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAdmin(req).catch(() => null);
    if (!me) return json(403, { error: "FORBIDDEN" });

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return json(400, { error: "INVALID_BODY" });

    const { userId, classId } = parsed.data;

    const [klass, user] = await Promise.all([
      prisma.class.findUnique({
        where: { id: classId },
        select: {
          id: true,
          date: true,
          capacity: true,
          isCanceled: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          bookingBlocked: true,
        },
      }),
    ]);

    if (!klass) return json(404, { error: "CLASS_NOT_FOUND" });
    if (!user) return json(404, { error: "USER_NOT_FOUND" });

    if (user.bookingBlocked) {
      return json(403, {
        code: "BOOKING_BLOCKED",
        error: BOOKING_BLOCKED_MESSAGE,
      });
    }

    if (klass.isCanceled) return json(409, { error: "CLASS_CANCELED" });
    if (klass.date.getTime() <= Date.now()) {
      return json(409, { error: "CLASS_IN_PAST" });
    }

    const activeCount = await prisma.booking.count({
      where: { classId, status: "ACTIVE" },
    });

    if (activeCount >= klass.capacity) {
      return json(400, { error: "CLASS_FULL" });
    }

    const existing = await prisma.booking.findFirst({
      where: {
        userId,
        classId,
        status: "ACTIVE",
      },
      select: { id: true },
    });

    if (existing) return json(409, { error: "ALREADY_ENROLLED" });

    const booking = await prisma.booking.create({
      data: {
        userId,
        classId,
        status: "ACTIVE",
      },
      include: {
        class: { select: { id: true, title: true, date: true } },
        user: { select: { id: true, email: true } },
      },
    });

    return NextResponse.json(
      { ok: true, booking },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("BOOKING ERROR:", error);
    return json(500, { error: "INTERNAL_ERROR" });
  }
}
