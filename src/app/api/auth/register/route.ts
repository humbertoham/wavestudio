// src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/zod";
import { hash } from "@/lib/hash";
import { Affiliation } from "@prisma/client";

export const runtime = "nodejs";

/** Helpers */
function cleanStr(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
function cleanEmail(v: unknown) {
  return cleanStr(v).toLowerCase();
}
function cleanPhone(v: unknown) {
  // Solo dígitos, tope 20 (tu columna es VarChar(20))
  const digits = String(v ?? "").replace(/\D+/g, "");
  return digits.slice(0, 20);
}
function parseAffiliation(v: unknown): Affiliation {
  const map: Record<string, Affiliation> = {
    NONE: Affiliation.NONE,
    WELLHUB: Affiliation.WELLHUB,
    TOTALPASS: Affiliation.TOTALPASS,
    // desde el front:
    none: Affiliation.NONE,
    wellhub: Affiliation.WELLHUB,
    totalpass: Affiliation.TOTALPASS,
  };
  const key = typeof v === "string" ? v : "NONE";
  return map[key] ?? Affiliation.NONE;
}
function parseDOB(v: unknown): Date | undefined {
  // Esperamos "YYYY-MM-DD" desde el front
  const s = cleanStr(v);
  if (!s) return undefined;
  // Construye como UTC para evitar off-by-one por timezone
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [_, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (isNaN(dt.getTime())) return undefined;
  // Evita fechas futuras por seguridad
  const today = new Date();
  if (dt > today) return undefined;
  return dt;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 1) Validación base con tu Zod (name/email/password)
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID" }, { status: 400 });
    }

    // 2) Normalización de los campos del schema
    const name = cleanStr(parsed.data.name);
    const email = cleanEmail(parsed.data.email);
    const password = cleanStr(parsed.data.password);

    // 3) Campos extra desde el body (pueden venir nulos o vacíos)
    const dateOfBirth = parseDOB(body?.dateOfBirth);
    const phone = cleanPhone(body?.phone);
    const emergencyPhone = cleanPhone(body?.emergencyPhone);
    const affiliation = parseAffiliation(body?.affiliation);

    // 4) Checar duplicado
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });
    }

    // 5) Crear usuario
    const passwordHash = await hash(password);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        // Solo guarda si hay valor válido; si no, Prisma deja NULL
        dateOfBirth: dateOfBirth ?? undefined,
        phone: phone ? phone : undefined,
        emergencyPhone: emergencyPhone ? emergencyPhone : undefined,
        affiliation, // enum con default NONE; aquí ya mapeado correctamente
      },
      select: { id: true, email: true },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (err: any) {
    // Manejo fino de Prisma P2002 (unique violation)
    if (err?.code === "P2002" && Array.isArray(err?.meta?.target) && err.meta.target.includes("email")) {
      return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });
    }
    // Fallback
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
