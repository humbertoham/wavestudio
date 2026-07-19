import {
  Affiliation,
  WellhubPlanConfirmationStatus,
  type Prisma,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma, requireAdmin } from "@/app/api/admin/_utils";

export const runtime = "nodejs";

function parsePage(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), max)
    : fallback;
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(req.url);
  let campaign = (searchParams.get("campaign") ?? "").trim();
  const page = parsePage(searchParams.get("page"), 1, 1_000_000);
  const pageSize = parsePage(searchParams.get("pageSize"), 25, 100);

  if (!campaign) {
    const latest = await prisma.wellhubPlanConfirmation.findFirst({
      orderBy: [{ requestedAt: "desc" }, { campaign: "desc" }],
      select: { campaign: true },
    });
    campaign = latest?.campaign ?? "";
  }

  if (!campaign) {
    return NextResponse.json(
      {
        campaign: null,
        totals: {
          included: 0,
          pending: 0,
          completed: 0,
          failedOrInconsistent: 0,
        },
        items: [],
        page,
        pageSize,
        totalPages: 1,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const where: Prisma.WellhubPlanConfirmationWhereInput = { campaign };
  const inconsistentWhere: Prisma.WellhubPlanConfirmationWhereInput = {
    campaign,
    OR: [
      {
        status: WellhubPlanConfirmationStatus.PENDING,
        OR: [
          { user: { affiliation: { not: Affiliation.WELLHUB } } },
          { user: { wellhubPlanConfirmationRequired: false } },
          {
            user: {
              wellhubPlanConfirmationCampaign: { not: campaign },
            },
          },
        ],
      },
      {
        status: WellhubPlanConfirmationStatus.COMPLETED,
        user: {
          wellhubPlanConfirmationRequired: true,
          wellhubPlanConfirmationCampaign: campaign,
        },
      },
    ],
  };

  const [included, pending, completed, failedOrInconsistent, items] =
    await prisma.$transaction([
      prisma.wellhubPlanConfirmation.count({ where }),
      prisma.wellhubPlanConfirmation.count({
        where: {
          campaign,
          status: WellhubPlanConfirmationStatus.PENDING,
        },
      }),
      prisma.wellhubPlanConfirmation.count({
        where: {
          campaign,
          status: WellhubPlanConfirmationStatus.COMPLETED,
        },
      }),
      prisma.wellhubPlanConfirmation.count({ where: inconsistentWhere }),
      prisma.wellhubPlanConfirmation.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          requestedAt: true,
          confirmedAt: true,
          previousPlan: true,
          selectedPlan: true,
          creditDeltaApplied: true,
          resultingBalance: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              affiliation: true,
              wellhubPlan: true,
              wellhubPlanConfirmationRequired: true,
              wellhubPlanConfirmedAt: true,
              wellhubPlanConfirmationCampaign: true,
            },
          },
        },
      }),
    ]);

  return NextResponse.json(
    {
      campaign,
      totals: { included, pending, completed, failedOrInconsistent },
      items,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(included / pageSize)),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
