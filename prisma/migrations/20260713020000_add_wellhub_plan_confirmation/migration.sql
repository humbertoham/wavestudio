-- Add a dedicated token-ledger reason for user-driven WellHub plan confirmation.
ALTER TYPE "TokenReason" ADD VALUE 'USER_WELLHUB_PLAN_CONFIRMATION';

-- Campaign status is intentionally separate from the user's current blocking
-- flag so previous campaigns remain auditable.
CREATE TYPE "WellhubPlanConfirmationStatus" AS ENUM ('PENDING', 'COMPLETED');

-- All defaults are non-blocking. Applying this migration never starts a
-- campaign or changes plans, credits, affiliations, or existing sessions.
ALTER TABLE "User"
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wellhubPlanConfirmationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wellhubPlanConfirmationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "wellhubPlanConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "wellhubPlanConfirmationCampaign" TEXT;

CREATE TABLE "WellhubPlanConfirmation" (
  "id" TEXT NOT NULL,
  "campaign" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "WellhubPlanConfirmationStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "previousPlan" "WellhubPlan",
  "selectedPlan" "WellhubPlan",
  "previousMonthlyEntitlement" INTEGER,
  "newMonthlyEntitlement" INTEGER,
  "creditDeltaApplied" INTEGER,
  "resultingBalance" INTEGER,
  "source" TEXT NOT NULL,
  "ledgerEntryId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WellhubPlanConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellhubPlanConfirmation_idempotencyKey_key"
  ON "WellhubPlanConfirmation"("idempotencyKey");

CREATE UNIQUE INDEX "WellhubPlanConfirmation_campaign_userId_key"
  ON "WellhubPlanConfirmation"("campaign", "userId");

CREATE INDEX "WellhubPlanConfirmation_campaign_status_requestedAt_idx"
  ON "WellhubPlanConfirmation"("campaign", "status", "requestedAt");

CREATE INDEX "WellhubPlanConfirmation_userId_requestedAt_idx"
  ON "WellhubPlanConfirmation"("userId", "requestedAt");

ALTER TABLE "WellhubPlanConfirmation"
  ADD CONSTRAINT "WellhubPlanConfirmation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
