import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function POST(_request: Request) {
  return NextResponse.json(
    { ok: false, code: "WELLHUB_NOT_CONFIGURED" },
    { status: 503, headers: NO_STORE_HEADERS }
  );
}

export function GET() {
  return NextResponse.json(
    { ok: false, code: "METHOD_NOT_ALLOWED" },
    {
      status: 405,
      headers: { ...NO_STORE_HEADERS, Allow: "POST" },
    }
  );
}
