// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = ["/", "/login", "/register", "/clases"]; // ajusta
const ADMIN_PATH = "/admin";
const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // solo proteger /admin (y opcionalmente /api/admin/*)
  if (!pathname.startsWith(ADMIN_PATH)) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  if (!token) return NextResponse.redirect(new URL("/login?next=" + pathname, req.url));

  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload?.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login?next=" + pathname, req.url));
  }
}

export const config = {
  matcher: ["/admin/:path*"], // protege todo /admin
};
