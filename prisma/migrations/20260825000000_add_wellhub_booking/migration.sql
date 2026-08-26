-- Additive persistence for the DEV-only Wellhub Booking API integration.
-- Existing bookings remain WAVE bookings. No package, credit, payment,
-- affiliation, TotalPass, or Wellhub check-in data is changed.

CREATE TYPE "BookingSource" AS ENUM ('WAVE', 'WELLHUB');
CREATE TYPE "WellhubBookingState" AS ENUM (
  'PENDING_CONFIRMATION',
  'RESERVED',
  'CONFIRMATION_ERROR',
  'CANCELED',
  'LATE_CANCELED',
  'CANCELED_BY_WAVE'
);
CREATE TYPE "WellhubBookingEventType" AS ENUM (
  'REQUESTED',
  'CANCELED',
  'LATE_CANCELED'
);
CREATE TYPE "WellhubBookingEventResult" AS ENUM (
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'CANCELED',
  'ERROR'
);
CREATE TYPE "WellhubClassSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'ERROR');

ALTER TABLE "Booking"
  ADD COLUMN "source" "BookingSource" NOT NULL DEFAULT 'WAVE',
  ADD COLUMN "wellhubBookingNumber" VARCHAR(120),
  ADD COLUMN "wellhubUserId" VARCHAR(64),
  ADD COLUMN "wellhubSlotId" VARCHAR(64),
  ADD COLUMN "wellhubState" "WellhubBookingState",
  ADD COLUMN "wellhubLastEventAt" TIMESTAMP(3),
  ADD COLUMN "wellhubLateCanceledAt" TIMESTAMP(3);

ALTER TABLE "Class"
  ADD COLUMN "wellhubClassId" VARCHAR(64),
  ADD COLUMN "wellhubSlotId" VARCHAR(64),
  ADD COLUMN "wellhubSyncStatus" "WellhubClassSyncStatus",
  ADD COLUMN "wellhubLastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "wellhubSyncError" VARCHAR(300);

CREATE UNIQUE INDEX "Booking_wellhubBookingNumber_key"
  ON "Booking"("wellhubBookingNumber");
CREATE INDEX "Booking_source_classId_status_idx"
  ON "Booking"("source", "classId", "status");
CREATE INDEX "Booking_wellhubUserId_classId_idx"
  ON "Booking"("wellhubUserId", "classId");
CREATE UNIQUE INDEX "Class_wellhubClassId_key" ON "Class"("wellhubClassId");
CREATE UNIQUE INDEX "Class_wellhubSlotId_key" ON "Class"("wellhubSlotId");

CREATE TABLE "WellhubBookingEvent" (
  "id" TEXT NOT NULL,
  "externalEventId" VARCHAR(120) NOT NULL,
  "eventType" "WellhubBookingEventType" NOT NULL,
  "result" "WellhubBookingEventResult" NOT NULL DEFAULT 'PROCESSING',
  "bookingNumber" VARCHAR(120) NOT NULL,
  "externalUserId" VARCHAR(64) NOT NULL,
  "externalSlotId" VARCHAR(64) NOT NULL,
  "externalClassId" VARCHAR(64) NOT NULL,
  "externalGymId" VARCHAR(64) NOT NULL,
  "eventTimestamp" VARCHAR(32) NOT NULL,
  "failureCode" VARCHAR(120),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "bookingId" TEXT,
  "classId" TEXT,

  CONSTRAINT "WellhubBookingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WellhubBookingEvent_externalEventId_key"
  ON "WellhubBookingEvent"("externalEventId");
CREATE UNIQUE INDEX "WellhubBookingEvent_eventType_bookingNumber_key"
  ON "WellhubBookingEvent"("eventType", "bookingNumber");
CREATE INDEX "WellhubBookingEvent_bookingNumber_receivedAt_idx"
  ON "WellhubBookingEvent"("bookingNumber", "receivedAt");
CREATE INDEX "WellhubBookingEvent_classId_receivedAt_idx"
  ON "WellhubBookingEvent"("classId", "receivedAt");
CREATE INDEX "WellhubBookingEvent_result_receivedAt_idx"
  ON "WellhubBookingEvent"("result", "receivedAt");

ALTER TABLE "WellhubBookingEvent"
  ADD CONSTRAINT "WellhubBookingEvent_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WellhubBookingEvent"
  ADD CONSTRAINT "WellhubBookingEvent_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
