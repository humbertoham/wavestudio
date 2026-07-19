import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import {
  classDeletionErrorCode,
  deleteClassFromCalendar,
} from "@/lib/class-deletion";

function noStore(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function invalidateClassCalendarPaths(classId: string) {
  try {
    revalidatePath("/clases");
    revalidatePath(`/clases/${classId}`);
    revalidatePath("/admin");
  } catch (error) {
    // These route responses and client reads are also explicitly no-store. A
    // framework invalidation failure must not turn a committed deletion into a
    // false API failure.
    console.error("[class-deletion] path invalidation failed", {
      classId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

/** Shared HTTP mapping keeps both deletion endpoints behaviorally identical. */
export async function executeClassDeletion(classId: string) {
  try {
    const result = await deleteClassFromCalendar(classId);

    if (result.outcome === "not_found") {
      return noStore(404, {
        ok: false,
        code: "CLASS_NOT_FOUND",
        message: "La clase no existe o ya fue eliminada.",
      });
    }

    if (result.outcome === "blocked") {
      return noStore(409, {
        ok: false,
        code: "CLASS_HAS_ACTIVE_DEPENDENCIES",
        message:
          "No se puede eliminar la clase porque todavía tiene reservas activas o personas en lista de espera.",
        details: {
          activeBookingCount: result.activeBookingCount,
          activeWaitlistCount: result.activeWaitlistCount,
        },
      });
    }

    invalidateClassCalendarPaths(classId);

    if (result.outcome === "archived") {
      return noStore(200, {
        ok: true,
        hardDeleted: false,
        archived: true,
        preservedInactiveBookingCount: result.inactiveBookingCount,
      });
    }

    return noStore(200, {
      ok: true,
      hardDeleted: true,
      archived: false,
    });
  } catch (error) {
    const code = classDeletionErrorCode(error);
    if (code === "CLASS_DELETE_CONFLICT") {
      return noStore(409, {
        ok: false,
        code,
        message:
          "La clase cambió mientras se intentaba eliminar. Intenta nuevamente.",
      });
    }

    console.error("[class-deletion] failed", {
      classId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return noStore(500, {
      ok: false,
      code: "UNEXPECTED_ERROR",
      message: "No se pudo eliminar la clase.",
    });
  }
}
