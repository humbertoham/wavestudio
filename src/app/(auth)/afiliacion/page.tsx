import { redirect } from "next/navigation";

import { getAuth } from "@/lib/auth";
import { DEFAULT_AUTHENTICATED_PATH } from "@/lib/login-navigation";
import { prisma } from "@/lib/prisma";
import {
  WELLHUB_CONFIRMATION_PATH,
  hasPendingWellhubPlanConfirmation,
} from "@/lib/wellhub-confirmation-gate";

export const dynamic = "force-dynamic";

export default async function ObsoleteAffiliationPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: {
      affiliation: true,
      wellhubPlanConfirmationRequired: true,
      wellhubPlanConfirmationCampaign: true,
      wellhubPlanConfirmations: {
        where: { status: "PENDING" },
        select: { campaign: true },
      },
    },
  });

  if (
    user &&
    hasPendingWellhubPlanConfirmation({
      affiliation: user.affiliation,
      wellhubPlanConfirmationRequired:
        user.wellhubPlanConfirmationRequired,
      wellhubPlanConfirmationCampaign:
        user.wellhubPlanConfirmationCampaign,
      pendingWellhubPlanConfirmationCampaigns:
        user.wellhubPlanConfirmations.map((record) => record.campaign),
    })
  ) {
    redirect(WELLHUB_CONFIRMATION_PATH);
  }

  redirect(DEFAULT_AUTHENTICATED_PATH);
}
