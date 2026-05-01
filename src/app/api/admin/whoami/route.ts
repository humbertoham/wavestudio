// src/app/api/admin/whoami/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession, requireAdmin } from "../_utils";

export const runtime = "nodejs";

function sanitizeUser(
  user: Awaited<ReturnType<typeof getUserFromSession>>
) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    role: user.role,
  };
}

export async function GET(req: NextRequest) {
  const hasCookie = !!req.cookies.get("session")?.value;

  const authError = await requireAdmin(req);
  if (authError) {
    const user = await getUserFromSession(req);
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
        hasCookie,
        user: sanitizeUser(user),
      },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const user = await getUserFromSession(req);

  return NextResponse.json(
    {
      ok: true,
      user: sanitizeUser(user),
      hasCookie,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
