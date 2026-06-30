// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

import { shouldRequireAffiliationOnboarding } from "@/lib/affiliation-gate";

const ADMIN_PATH = "/admin";
const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get("session")?.value;
  let payload: Record<string, unknown> | null = null;

  if (token) {
    try {
      const verified = await jwtVerify(token, secret);
      payload = verified.payload;
    } catch {
      payload = null;
    }
  }

  // solo proteger /admin (y opcionalmente /api/admin/*)
  if (pathname.startsWith(ADMIN_PATH)) {
    if (!payload) {
      return NextResponse.redirect(new URL("/login?next=" + pathname, req.url));
    }

    if (payload?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  if (shouldRequireAffiliationOnboarding(pathname, payload)) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json(
        {
          error: "AFFILIATION_REQUIRED",
          message: "Debes seleccionar tu afiliacion para continuar.",
        },
        { status: 428, headers: { "Cache-Control": "no-store" } }
      );
    }

    const nextPath = `${pathname}${search}`;
    return NextResponse.redirect(
      new URL(`/afiliacion?next=${encodeURIComponent(nextPath)}`, req.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/clases/:path*",
    "/compras/:path*",
    "/dashboard/:path*",
    "/mis-clases/:path*",
    "/perfil/:path*",
    "/reservas/:path*",
    "/api/:path*",
  ],
};
