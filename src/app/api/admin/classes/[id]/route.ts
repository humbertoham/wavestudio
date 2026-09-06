import { Prisma } from "@prisma/client";
import { zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";
import { NextRequest, NextResponse } from "next/server";

import {
  requireAdminUser,
  requireClassManagerUser,
} from "../../_utils";
import { executeClassDeletion } from "@/lib/class-deletion-response";
import {
  payrollErrorResponse,
  redactClassPayroll,
  runPayrollTransaction,
  updateClassWithPayrollAssignment,
} from "@/lib/payroll";

export const runtime = "nodejs";

const USER_TZ = "America/Monterrey";

type Ctx = { params: Promise<{ id: string }> };

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function updateError(error: unknown) {
  const known = payrollErrorResponse(error);
  if (known) return NextResponse.json(known.body, { status: known.status });

  console.error("CLASS_UPDATE_ERROR", error);
  return json(500, {
    error: "CLASS_UPDATE_FAILED",
    message: "No se pudo actualizar la clase.",
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const { title, focus, durationMin, capacity, instructorId, date } = raw ?? {};
    const data: Prisma.ClassUncheckedUpdateInput = {};

    if (title !== undefined) data.title = String(title);
    if (focus !== undefined) data.focus = String(focus);
    if (durationMin !== undefined) data.durationMin = Number(durationMin);
    if (capacity !== undefined) data.capacity = Number(capacity);
    if (date) {
      data.date = zonedTimeToUtc(String(date).replace("T", " "), USER_TZ);
    }

    const updated = await runPayrollTransaction((tx) =>
      updateClassWithPayrollAssignment(tx, {
        classId: id,
        data,
        instructorId:
          instructorId === undefined ? undefined : String(instructorId),
        actorUserId: auth.user.id,
      })
    );

    return NextResponse.json(redactClassPayroll(updated));
  } catch (error) {
    return updateError(error);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  return executeClassDeletion(id);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireClassManagerUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await ctx.params;
    const raw = await req.json();
    const {
      title,
      focus,
      durationMin,
      capacity,
      instructorId,
      time,
    } = raw ?? {};

    const updated = await runPayrollTransaction(async (tx) => {
      const cls = await tx.class.findUnique({
        where: { id },
        include: {
          bookings: { where: { status: "ACTIVE" } },
        },
      });
      if (!cls || cls.deletedAt) {
        throw new PayrollClassNotFoundError();
      }

      const usedSpots = cls.bookings.reduce(
        (sum, booking) => sum + (booking.quantity ?? 1),
        0
      );
      const nextCapacity =
        capacity === undefined ? undefined : Number(capacity);
      if (nextCapacity !== undefined && nextCapacity < usedSpots) {
        throw new CapacityTooSmallError(usedSpots);
      }

      const data: Prisma.ClassUncheckedUpdateInput = {};
      if (title !== undefined) data.title = String(title);
      if (focus !== undefined) data.focus = String(focus);
      if (durationMin !== undefined) data.durationMin = Number(durationMin);
      if (nextCapacity !== undefined) data.capacity = nextCapacity;

      if (time) {
        const [hour, minute] = String(time).split(":").map(Number);
        if (Number.isFinite(hour) && Number.isFinite(minute)) {
          const local = utcToZonedTime(new Date(cls.date), USER_TZ);
          const localLike = [
            `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`,
            `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
          ].join(" ");
          data.date = zonedTimeToUtc(localLike, USER_TZ);
        }
      }

      return updateClassWithPayrollAssignment(tx, {
        classId: id,
        data,
        instructorId:
          instructorId === undefined ? undefined : String(instructorId ?? ""),
        actorUserId: auth.user.id,
        includeBookings: true,
      });
    });

    return NextResponse.json(redactClassPayroll(updated));
  } catch (error) {
    if (error instanceof CapacityTooSmallError) {
      return json(400, {
        error: "CAPACITY_TOO_SMALL",
        usedSpots: error.usedSpots,
      });
    }
    if (error instanceof PayrollClassNotFoundError) {
      return json(404, { error: "CLASS_NOT_FOUND" });
    }
    return updateError(error);
  }
}

class CapacityTooSmallError extends Error {
  constructor(public readonly usedSpots: number) {
    super("CAPACITY_TOO_SMALL");
  }
}

class PayrollClassNotFoundError extends Error {
  constructor() {
    super("CLASS_NOT_FOUND");
  }
}
