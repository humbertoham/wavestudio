-- Production lineage: replaces DEV 20261011000000; never include both base migrations.
-- Existing bookings retain the neutral CREDITS attribution default. No historical
-- owner/source inference or booking-row backfill is performed. New guest bookings
-- are explicitly attributed by the application at creation time.
CREATE TYPE "PackType" AS ENUM ('STANDARD', 'MONTHLY_UNLIMITED');
CREATE TYPE "BookingEntitlement" AS ENUM ('CREDITS', 'MONTHLY_UNLIMITED', 'MIXED', 'WELLHUB', 'ADMIN_GUEST');

ALTER TABLE "Pack"
  ADD COLUMN "type" "PackType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "unlimitedMonth" INTEGER,
  ADD COLUMN "unlimitedYear" INTEGER;

ALTER TABLE "PackPurchase"
  ADD COLUMN "type" "PackType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "unlimitedMonth" INTEGER,
  ADD COLUMN "unlimitedYear" INTEGER,
  ADD COLUMN "nameSnapshot" TEXT,
  ADD COLUMN "priceSnapshot" INTEGER,
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revocationReason" TEXT;

ALTER TABLE "Payment" ADD COLUMN "packSnapshot" JSONB;
ALTER TABLE "Booking" ADD COLUMN "entitlementType" "BookingEntitlement" NOT NULL DEFAULT 'CREDITS';

ALTER TABLE "Pack" ADD CONSTRAINT "Pack_monthly_terms_check" CHECK (
  ("type" = 'STANDARD' AND "unlimitedMonth" IS NULL AND "unlimitedYear" IS NULL)
  OR ("type" = 'MONTHLY_UNLIMITED' AND "unlimitedMonth" BETWEEN 1 AND 12
    AND "unlimitedYear" BETWEEN 2000 AND 2200 AND "classes" = 0 AND "validityDays" = 0
    AND "unlimitedMonth" IS NOT NULL AND "unlimitedYear" IS NOT NULL)
);
ALTER TABLE "PackPurchase" ADD CONSTRAINT "PackPurchase_monthly_terms_check" CHECK (
  ("type" = 'STANDARD' AND "unlimitedMonth" IS NULL AND "unlimitedYear" IS NULL)
  OR ("type" = 'MONTHLY_UNLIMITED' AND "unlimitedMonth" BETWEEN 1 AND 12
    AND "unlimitedYear" BETWEEN 2000 AND 2200 AND "classesLeft" = 0
    AND "unlimitedMonth" IS NOT NULL AND "unlimitedYear" IS NOT NULL)
);

CREATE TABLE "UnlimitedUsage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchaseId" TEXT NOT NULL REFERENCES "PackPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bookingId" TEXT NOT NULL REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "serviceDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" TEXT
);
CREATE UNIQUE INDEX "UnlimitedUsage_bookingId_key" ON "UnlimitedUsage"("bookingId");
CREATE UNIQUE INDEX "UnlimitedUsage_one_consumed_day"
  ON "UnlimitedUsage"("userId", "serviceDate") WHERE "releasedAt" IS NULL;
CREATE INDEX "UnlimitedUsage_purchaseId_serviceDate_idx" ON "UnlimitedUsage"("purchaseId", "serviceDate");
CREATE INDEX "UnlimitedUsage_userId_serviceDate_idx" ON "UnlimitedUsage"("userId", "serviceDate");
CREATE INDEX "PackPurchase_userId_type_unlimitedYear_unlimitedMonth_idx"
  ON "PackPurchase"("userId", "type", "unlimitedYear", "unlimitedMonth");
