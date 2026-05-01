import { NextResponse } from "next/server";
import { Affiliation, Prisma } from "@prisma/client";

import { hash } from "@/lib/hash";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { registerSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WELLHUB_PACK_ID = "corp_wellhub_monthly";
const TOTALPASS_PACK_ID = "corp_totalpass_monthly";

type RegisterResult = {
  user: {
    id: string;
    email: string;
  };
  corporateGrant:
    | {
        packId: string;
        packPurchaseId: string;
        classesGranted: number;
      }
    | null;
};

class RegisterHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown
  ) {
    super(code);
  }
}

function cleanStr(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanEmail(value: unknown) {
  return cleanStr(value).toLowerCase();
}

function cleanPhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  return digits.slice(0, 20);
}

function parseAffiliation(value: unknown): Affiliation {
  const map: Record<string, Affiliation> = {
    NONE: Affiliation.NONE,
    WELLHUB: Affiliation.WELLHUB,
    TOTALPASS: Affiliation.TOTALPASS,
    none: Affiliation.NONE,
    wellhub: Affiliation.WELLHUB,
    totalpass: Affiliation.TOTALPASS,
  };

  const key = typeof value === "string" ? value : "NONE";
  return map[key] ?? Affiliation.NONE;
}

function parseDOB(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new RegisterHttpError(400, "INVALID_DATE_OF_BIRTH");
  }

  const [, y, mo, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));

  if (Number.isNaN(date.getTime()) || date > new Date()) {
    throw new RegisterHttpError(400, "INVALID_DATE_OF_BIRTH");
  }

  return date;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";

  const safeLocal =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;

  return `${safeLocal}@${domain}`;
}

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function ensureCorporatePacks(tx: Prisma.TransactionClient) {
  await tx.pack.upsert({
    where: { id: WELLHUB_PACK_ID },
    update: {
      name: "Wellhub Mensual (Interno)",
      classes: 15,
      price: 0,
      validityDays: 31,
      isActive: false,
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
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "15 clases",
    },
  });

  await tx.pack.upsert({
    where: { id: TOTALPASS_PACK_ID },
    update: {
      name: "TotalPass Mensual (Interno)",
      classes: 10,
      price: 0,
      validityDays: 31,
      isActive: false,
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
      isActive: false,
      isVisible: false,
      oncePerUser: false,
      classesLabel: "10 clases",
    },
  });
}

function nextMonthStartUTC(from = new Date()) {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1));
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const rate = await consumeRateLimit(`register:${getClientIp(req)}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });

  if (rate.limited) {
    return json(429, {
      error: "RATE_LIMITED",
      message: "Demasiados intentos de registro. Intenta mas tarde.",
      requestId,
    });
  }

  try {
    let body: unknown;

    try {
      body = await req.json();
    } catch (error) {
      console.error("[register] invalid_json", { requestId }, error);
      return json(400, {
        error: "INVALID_JSON",
        message: "El body debe ser JSON valido.",
        requestId,
      });
    }

    console.info("[register] request_input", {
      requestId,
      hasBody: body != null,
      keys:
        body && typeof body === "object"
          ? Object.keys(body as Record<string, unknown>)
          : [],
    });

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;

      console.warn("[register] validation_failed", {
        requestId,
        fieldErrors,
      });

      return json(400, {
        error: "INVALID_BODY",
        message: "Los datos de registro no son validos.",
        fields: fieldErrors,
        requestId,
      });
    }

    const name = cleanStr(parsed.data.name);
    const email = cleanEmail(parsed.data.email);
    const password = cleanStr(parsed.data.password);
    const dateOfBirth = parseDOB(parsed.data.dateOfBirth);
    const phone = cleanPhone(parsed.data.phone);
    const emergencyPhone = cleanPhone(parsed.data.emergencyPhone);
    const affiliation = parseAffiliation(parsed.data.affiliation);

    console.info("[register] normalized_input", {
      requestId,
      email: maskEmail(email),
      affiliation,
      hasDateOfBirth: true,
      phoneDigits: phone.length,
      emergencyPhoneDigits: emergencyPhone.length,
    });

    const exists = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (exists) {
      console.warn("[register] email_in_use", {
        requestId,
        email: maskEmail(email),
        userId: exists.id,
      });

      return json(409, {
        error: "EMAIL_IN_USE",
        message: "Este correo ya esta registrado.",
        requestId,
      });
    }

    const passwordHash = await hash(password);

    console.info("[register] before_db_write", {
      requestId,
      email: maskEmail(email),
      affiliation,
    });

    const result = await prisma.$transaction<RegisterResult>(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          dateOfBirth,
          phone,
          emergencyPhone,
          affiliation,
        },
        select: { id: true, email: true },
      });

      if (
        affiliation !== Affiliation.WELLHUB &&
        affiliation !== Affiliation.TOTALPASS
      ) {
        return { user, corporateGrant: null };
      }

      await ensureCorporatePacks(tx);

      const classesGranted = affiliation === Affiliation.WELLHUB ? 15 : 10;
      const packId =
        affiliation === Affiliation.WELLHUB
          ? WELLHUB_PACK_ID
          : TOTALPASS_PACK_ID;

      const purchase = await tx.packPurchase.create({
        data: {
          userId: user.id,
          packId,
          classesLeft: classesGranted,
          expiresAt: nextMonthStartUTC(new Date()),
        },
        select: { id: true },
      });

      await tx.tokenLedger.create({
        data: {
          userId: user.id,
          packPurchaseId: purchase.id,
          delta: classesGranted,
          reason: "CORPORATE_MONTHLY",
        },
      });

      return {
        user,
        corporateGrant: {
          packId,
          packPurchaseId: purchase.id,
          classesGranted,
        },
      };
    });

    console.info("[register] after_db_write", {
      requestId,
      userId: result.user.id,
      email: maskEmail(result.user.email),
      corporateGrant: result.corporateGrant,
    });

    return json(201, {
      ...result.user,
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof RegisterHttpError) {
      console.error("[register] handled_error", {
        requestId,
        code: error.code,
        details: error.details,
      });

      return json(error.status, {
        error: error.code,
        message: "No se pudo completar el registro.",
        details: error.details ?? null,
        requestId,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const target = Array.isArray(error.meta?.target)
        ? error.meta.target
        : typeof error.meta?.target === "string"
          ? [error.meta.target]
          : [];

      console.error("[register] prisma_error", {
        requestId,
        code: error.code,
        meta: error.meta,
        message: error.message,
      });

      if (
        error.code === "P2002" &&
        target.some((value) => String(value).includes("email"))
      ) {
        return json(409, {
          error: "EMAIL_IN_USE",
          message: "Este correo ya esta registrado.",
          requestId,
        });
      }

      return json(500, {
        error: "DATABASE_ERROR",
        message: "Ocurrio un error al guardar el usuario.",
        requestId,
      });
    }

    console.error("[register] unexpected_error", { requestId }, error);

    return json(500, {
      error: "INTERNAL_ERROR",
      message: "Ocurrio un error interno al crear la cuenta.",
      requestId,
    });
  }
}
