CREATE TYPE "public"."WellhubPlan" AS ENUM ('GOLD_PLUS', 'PLATINUM', 'DIAMOND', 'DIAMOND_PLUS');

ALTER TABLE "public"."User"
ADD COLUMN "wellhubPlan" "public"."WellhubPlan",
ADD COLUMN "affiliationConfirmedAt" TIMESTAMP(3);

CREATE INDEX "User_affiliation_wellhubPlan_idx" ON "public"."User"("affiliation", "wellhubPlan");
