import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    const auth = await requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: auth.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        affiliation: true,
        wellhubPlan: true,
        affiliationConfirmedAt: true,
        authVersion: true,
        wellhubPlanConfirmationRequired: true,
        wellhubPlanConfirmationRequestedAt: true,
        wellhubPlanConfirmedAt: true,
        wellhubPlanConfirmationCampaign: true,
      },
    });

    if (!user) return noStore(null);

    const affiliationConfirmed = user.affiliationConfirmedAt != null;
    const res = noStore({
      ...user,
      affiliationConfirmed,
    });

    if (
      auth.affiliationConfirmed !== affiliationConfirmed ||
      auth.role !== user.role ||
      auth.sessionVersion !== user.authVersion ||
      auth.wellhubPlanConfirmationRequired !==
        user.wellhubPlanConfirmationRequired ||
      auth.wellhubPlanConfirmationCampaign !==
        user.wellhubPlanConfirmationCampaign
    ) {
      res.cookies.set(
        "session",
        signToken({
          sub: user.id,
          role: user.role,
          affiliationConfirmed,
          sessionVersion: user.authVersion,
          wellhubPlanConfirmationRequired:
            user.wellhubPlanConfirmationRequired,
          wellhubPlanConfirmationCampaign:
            user.wellhubPlanConfirmationCampaign,
        }),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 7,
        }
      );
    }

    return res;
  } catch (e: any) {
    const code = e?.message === "UNAUTHORIZED" ? 401 : 500;
    return noStore({ error: e?.message ?? "ERROR" }, code);
  }
}
