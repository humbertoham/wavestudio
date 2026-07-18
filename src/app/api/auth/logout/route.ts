import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/session-cookie";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const res = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  clearSessionCookie(res, req);
  return res;
}
