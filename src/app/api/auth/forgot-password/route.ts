import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { resend } from "@/lib/resend";

export const runtime = "nodejs";

function resolveResetUrl(token: string) {
  const appBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrl) {
    throw new Error("APP_BASE_URL_MISSING");
  }

  return new URL(`/reset-password?token=${token}`, appBaseUrl).toString();
}

export async function POST(req: Request) {
  try {
    const rate = await consumeRateLimit(`forgot-password:${getClientIp(req)}`, {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (rate.limited) {
      return NextResponse.json(
        { error: "RATE_LIMITED" },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfter) },
        }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      email?: unknown;
    } | null;

    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ ok: true });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Keep the response neutral so we never reveal whether the email exists.
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    const token = randomBytes(32).toString("hex");

    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    const resetUrl = resolveResetUrl(token);

    await resend.emails.send({
      from: "Wave Studio <no-reply@mail.wavestudio.mx>",
      to: email,
      subject: "Restablecer tu contrasena",
      html: `
        <div style="font-family: sans-serif; line-height: 1.5">
          <h2>Restablecer contrasena</h2>
          <p>Haz clic en el siguiente enlace para cambiar tu contrasena:</p>
          <p>
            <a href="${resetUrl}" target="_blank">
              Cambiar contrasena
            </a>
          </p>
          <p>Este enlace expira en 15 minutos.</p>
          <p>Si no solicitaste esto, puedes ignorar este correo.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("FORGOT_PASSWORD_ERROR", error);
    return NextResponse.json({ ok: true });
  }
}
