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
  const digits = String(v ?? "").replace(/\D+/g, "");
  return digits.slice(0, 20);
}
function parseAffiliation(v: unknown): Affiliation {
  const map: Record<string, Affiliation> = {
    NONE: Affiliation.NONE,
    WELLHUB: Affiliation.WELLHUB,
    TOTALPASS: Affiliation.TOTALPASS,
    none: Affiliation.NONE,
    wellhub: Affiliation.WELLHUB,
    totalpass: Affiliation.TOTALPASS,
  };
  const key = typeof v === "string" ? v : "NONE";
  return map[key] ?? Affiliation.NONE;
}
function parseDOB(v: unknown): Date | undefined {
  const s = cleanStr(v);
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [_, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (isNaN(dt.getTime())) return undefined;
  const today = new Date();
  if (dt > today) return undefined;
  return dt;
}

// Packs internos (no visibles)
const WELLHUB_PACK_ID = "corp_wellhub_monthly";
const TOTALPASS_PACK_ID = "corp_totalpass_monthly";

async function ensureCorporatePacks() {
  await prisma.pack.upsert({
    where: { id: WELLHUB_PACK_ID },
    update: {
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      isActive: true,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "15 clases",
    },
    create: {
      id: WELLHUB_PACK_ID,
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      isActive: true,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "15 clases",
    },
  });

  await prisma.pack.upsert({
    where: { id: TOTALPASS_PACK_ID },
    update: {
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: true,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
    create: {
      id: TOTALPASS_PACK_ID,
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: true,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
  });
}

function nextMonthStartUTC(from = new Date()) {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1)); // inicio del próximo mes UTC
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // 1) Validación base con tu Zod (name/email/password)
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID" }, { status: 400 });
    }

    // 2) Normalización
    const name = cleanStr(parsed.data.name);
    const email = cleanEmail(parsed.data.email);
    const password = cleanStr(parsed.data.password);

    // 3) Campos extra
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
        dateOfBirth: dateOfBirth ?? undefined,
        phone: phone ? phone : undefined,
        emergencyPhone: emergencyPhone ? emergencyPhone : undefined,
        affiliation,
      },
      select: { id: true, email: true },
    });

    // ✅ 6) Si es corporate, asignar saldo REAL como PackPurchase (y ledger como auditoría)
    if (
      affiliation === Affiliation.WELLHUB ||
      affiliation === Affiliation.TOTALPASS
    ) {
      await ensureCorporatePacks();

      const monthlyAmount = affiliation === Affiliation.WELLHUB ? 15 : 10;
      const packId =
        affiliation === Affiliation.WELLHUB ? WELLHUB_PACK_ID : TOTALPASS_PACK_ID;

      const expiresAt = nextMonthStartUTC(new Date()); // expira al iniciar el próximo mes UTC

      const purchase = await prisma.packPurchase.create({
        data: {
          userId: user.id,
          packId,
          classesLeft: monthlyAmount,
          expiresAt,
        },
        select: { id: true },
      });

      await prisma.tokenLedger.create({
        data: {
          userId: user.id,
          packPurchaseId: purchase.id,
          delta: monthlyAmount,
          reason: "CORPORATE_MONTHLY",
        },
      });
    }

    return NextResponse.json(user, { status: 201 });
  } catch (err: any) {
    if (
      err?.code === "P2002" &&
      Array.isArray(err?.meta?.target) &&
      err.meta.target.includes("email")
    ) {
      return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}