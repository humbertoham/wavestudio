import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { normalizeAffiliationAndPlan } from "@/lib/affiliation";
import { hash } from "@/lib/hash";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { ensureCorporatePacks, getCorporateGrantConfig } from "@/lib/wellhub";
import { registerSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function parseDOB(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new RegisterHttpError(400, "INVALID_DATE_OF_BIRTH");
  }

  const [, y, mo, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d) ||
    date > new Date()
  ) {
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

function firstFieldMessage(fieldErrors: Record<string, string[] | undefined>) {
  for (const key of [
    "name",
    "email",
    "password",
    "dateOfBirth",
    "phone",
    "emergencyPhone",
    "affiliation",
    "wellhubPlan",
  ]) {
    const messages = fieldErrors[key];
    if (messages?.[0]) return messages[0];
  }

  return "Revisa los datos del formulario.";
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
        message: firstFieldMessage(fieldErrors),
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
    const affiliationSelection = normalizeAffiliationAndPlan(
      parsed.data.affiliation,
      parsed.data.wellhubPlan
    );

    if (!affiliationSelection.ok) {
      return json(400, {
        error: affiliationSelection.code,
        message: affiliationSelection.message,
        fields: {
          [affiliationSelection.field]: [affiliationSelection.message],
        },
        requestId,
      });
    }

    const { affiliation, wellhubPlan } = affiliationSelection;

    console.info("[register] normalized_input", {
      requestId,
      email: maskEmail(email),
      affiliation,
      wellhubPlan,
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
        message: "Ya existe una cuenta con este correo.",
        requestId,
      });
    }

    const passwordHash = await hash(password);

    console.info("[register] before_db_write", {
      requestId,
      email: maskEmail(email),
      affiliation,
      wellhubPlan,
    });

    const result = await prisma.$transaction<RegisterResult>(async (tx) => {
      const affiliationConfirmedAt = new Date();
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          dateOfBirth,
          phone,
          emergencyPhone,
          affiliation,
          wellhubPlan,
          affiliationConfirmedAt,
        },
        select: { id: true, email: true },
      });

      const grant = getCorporateGrantConfig(affiliation, wellhubPlan);

      if (!grant) {
        return { user, corporateGrant: null };
      }

      await ensureCorporatePacks(tx);

      const purchase = await tx.packPurchase.create({
        data: {
          userId: user.id,
          packId: grant.packId,
          classesLeft: grant.classesGranted,
          expiresAt: nextMonthStartUTC(new Date()),
        },
        select: { id: true },
      });

      await tx.tokenLedger.create({
        data: {
          userId: user.id,
          packPurchaseId: purchase.id,
          delta: grant.classesGranted,
          reason: "CORPORATE_MONTHLY",
        },
      });

      return {
        user,
        corporateGrant: {
          packId: grant.packId,
          packPurchaseId: purchase.id,
          classesGranted: grant.classesGranted,
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
        message:
          error.code === "INVALID_DATE_OF_BIRTH"
            ? "Ingresa una fecha de nacimiento válida."
            : "No se pudo completar el registro.",
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
          message: "Ya existe una cuenta con este correo.",
          requestId,
        });
      }

      if (error.code === "P2021" || error.code === "P2022") {
        return json(503, {
          error: "SCHEMA_MIGRATION_REQUIRED",
          message:
            "La base de datos de este ambiente no tiene las migraciones requeridas. Ejecuta las migraciones antes de registrar usuarios.",
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
