// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );

  // IMPORTANT: usa los mismos atributos que al crearla
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // si tu cookie original tenía domain, agrégalo aquí también:
    // domain: ".tudominio.com",
  };

  res.cookies.set({
    name: "session",
    value: "",
    maxAge: 0,
    expires: new Date(0),
    ...common,
  });

  return res;
}
