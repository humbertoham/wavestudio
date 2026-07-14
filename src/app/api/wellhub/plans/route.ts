import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import {
  WELLHUB_PLAN_CREDITS,
  WELLHUB_PLAN_LABELS,
  WELLHUB_PLANS,
} from "@/lib/wellhub-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireAuth(req).catch(() => null);
  if (!auth) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Inicia sesion para continuar." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      plans: WELLHUB_PLANS.map((value) => ({
        value,
        label: WELLHUB_PLAN_LABELS[value],
        credits: WELLHUB_PLAN_CREDITS[value],
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
