-- Persist Wellhub Access Control webhook idempotency and validation outcomes.
-- This is additive and does not change affiliations, plans, credits, bookings,
-- packages, roles, or existing Mercado Pago webhook records.
CREATE TYPE "WellhubCheckinStatus" AS ENUM (
  'RECEIVED',
  'AUTHORIZED',
  'REJECTED',
  'ERROR'
);

CREATE TABLE "WellhubCheckin" (
  "id" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "externalGymId" TEXT NOT NULL,
  "externalProductId" TEXT NOT NULL,
  "eventTimestamp" TEXT NOT NULL,
  "matchedUserId" TEXT,
  "status" "WellhubCheckinStatus" NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validatedAt" TIMESTAMP(3),
  "failureCode" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WellhubCheckin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellhubCheckin_externalEventId_key"
  ON "WellhubCheckin"("externalEventId");

CREATE INDEX "WellhubCheckin_externalUserId_receivedAt_idx"
  ON "WellhubCheckin"("externalUserId", "receivedAt");

CREATE INDEX "WellhubCheckin_matchedUserId_receivedAt_idx"
  ON "WellhubCheckin"("matchedUserId", "receivedAt");

CREATE INDEX "WellhubCheckin_status_receivedAt_idx"
  ON "WellhubCheckin"("status", "receivedAt");

ALTER TABLE "WellhubCheckin"
  ADD CONSTRAINT "WellhubCheckin_matchedUserId_fkey"
  FOREIGN KEY ("matchedUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
