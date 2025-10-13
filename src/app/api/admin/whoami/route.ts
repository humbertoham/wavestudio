import { NextRequest, NextResponse } from "next/server";
import { getUserFromSession, requireAdmin, runtime } from "../_utils";

export { runtime }; // "nodejs"

export async function GET(req: NextRequest) {
  const hasCookie = !!req.cookies.get("session")?.value;
  const user = await getUserFromSession(req); // lee sub y va a DB
  const isAdmin = !!user && user.role === "ADMIN";

  if (!isAdmin) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", hasCookie, user, dbUrl: process.env.DATABASE_URL?.slice(0, 40) },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    { ok: true, user, hasCookie, dbUrl: process.env.DATABASE_URL?.slice(0, 40) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
