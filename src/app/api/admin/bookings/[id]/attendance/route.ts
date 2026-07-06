import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../../_utils";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req);
  if (auth) return auth;

  const { id } = await ctx.params;
  const { attended } = await req.json();

  if (typeof attended !== "boolean") {
    return NextResponse.json(
      { error: "INVALID_ATTENDED_VALUE" },
      { status: 400 }
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      attended: true,
    },
  });

  if (!booking) {
    return NextResponse.json(
      { error: "BOOKING_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (booking.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "BOOKING_NOT_ACTIVE" },
      { status: 400 }
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: { attended },
  });

  return NextResponse.json({
    id: updated.id,
    attended: updated.attended,
  });
}
