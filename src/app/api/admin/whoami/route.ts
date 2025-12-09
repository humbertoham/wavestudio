// src/app/api/admin/whoami/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession, requireAdmin } from "../_utils";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const hasCookie = !!req.cookies.get("session")?.value;

  const authError = await requireAdmin(req);
  if (authError) {
    const user = await getUserFromSession(req); // may be null, but nice for debugging
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
        hasCookie,
        user,
        dbUrl: process.env.DATABASE_URL?.slice(0, 40),
      },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const user = await getUserFromSession(req);

  return NextResponse.json(
    {
      ok: true,
      user,
      hasCookie,
      dbUrl: process.env.DATABASE_URL?.slice(0, 40),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
