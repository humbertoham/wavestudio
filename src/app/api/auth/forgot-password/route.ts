import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { resend } from "@/lib/resend";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json({ ok: true });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    // ⚠️ Siempre respondemos OK (no revelamos si existe o no)
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    // 🔐 borrar tokens anteriores (opcional pero recomendado)
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // 🔑 generar token seguro
    const token = randomBytes(32).toString("hex");

    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
      },
    });

    const resetUrl = `${process.env.APP_BASE_URL}/reset-password?token=${token}`;

    await resend.emails.send({
      from: "Wave Studio <no-reply@mail.wavestudio.mx>",
      to: email,
      subject: "Restablecer tu contraseña",
      html: `
        <div style="font-family: sans-serif; line-height: 1.5">
          <h2>Restablecer contraseña</h2>
          <p>Haz clic en el siguiente enlace para cambiar tu contraseña:</p>
          <p>
            <a href="${resetUrl}" target="_blank">
              Cambiar contraseña
            </a>
          </p>
          <p>Este enlace expira en 15 minutos.</p>
          <p>Si no solicitaste esto, puedes ignorar este correo.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("FORGOT_PASSWORD_ERROR", err);
    return NextResponse.json({ ok: true });
  }
}
