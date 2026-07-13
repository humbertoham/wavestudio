import { Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { getUserFromSession } from "@/app/api/admin/_utils";

export async function requireChallengeAdmin(req: NextRequest) {
  const user = await getUserFromSession(req);

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "UNAUTHORIZED", code: "UNAUTHORIZED" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  if (user.role !== Role.ADMIN) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: "FORBIDDEN",
          code: "FORBIDDEN",
          message: "No tienes permiso para administrar el Challenge.",
        },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return { ok: true as const, user };
}
