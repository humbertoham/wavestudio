-- CreateEnum
CREATE TYPE "ChallengePointReason" AS ENUM ('ATTENDANCE_AWARD', 'ATTENDANCE_REVERSAL');

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activationVersion" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedById" TEXT,
    "deactivatedById" TEXT,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable fields deliberately leave every historical class ineligible.
ALTER TABLE "Class"
ADD COLUMN "challengeId" TEXT,
ADD COLUMN "challengePoints" INTEGER,
ADD COLUMN "challengeEligibleAt" TIMESTAMP(3),
ADD COLUMN "challengeActivationVersion" INTEGER;

-- CreateTable
CREATE TABLE "ChallengeUserTotal" (
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeUserTotal_pkey" PRIMARY KEY ("challengeId", "userId")
);

-- CreateTable
CREATE TABLE "ChallengeBookingAward" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointsSnapshot" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "isAwarded" BOOLEAN NOT NULL DEFAULT true,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeBookingAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengePointLedger" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" "ChallengePointReason" NOT NULL,
    "pointsSnapshot" INTEGER NOT NULL,
    "cycle" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengePointLedger_pkey" PRIMARY KEY ("id")
);

-- Integrity constraints (Prisma cannot currently express these checks/partial index).
ALTER TABLE "Challenge"
ADD CONSTRAINT "Challenge_activationVersion_check" CHECK ("activationVersion" >= 0);

ALTER TABLE "Class"
ADD CONSTRAINT "Class_challengePoints_check" CHECK ("challengePoints" IS NULL OR "challengePoints" BETWEEN 1 AND 10),
ADD CONSTRAINT "Class_challengeEligibility_check" CHECK (
  ("challengeId" IS NULL AND "challengePoints" IS NULL AND "challengeEligibleAt" IS NULL AND "challengeActivationVersion" IS NULL)
  OR
  ("challengeId" IS NOT NULL AND "challengePoints" IS NOT NULL AND "challengeEligibleAt" IS NOT NULL AND "challengeActivationVersion" IS NOT NULL)
);

ALTER TABLE "ChallengeUserTotal"
ADD CONSTRAINT "ChallengeUserTotal_points_check" CHECK ("points" >= 0);

ALTER TABLE "ChallengeBookingAward"
ADD CONSTRAINT "ChallengeBookingAward_pointsSnapshot_check" CHECK ("pointsSnapshot" BETWEEN 1 AND 10),
ADD CONSTRAINT "ChallengeBookingAward_cycle_check" CHECK ("cycle" >= 1);

ALTER TABLE "ChallengePointLedger"
ADD CONSTRAINT "ChallengePointLedger_pointsSnapshot_check" CHECK ("pointsSnapshot" BETWEEN 1 AND 10),
ADD CONSTRAINT "ChallengePointLedger_cycle_check" CHECK ("cycle" >= 1),
ADD CONSTRAINT "ChallengePointLedger_delta_reason_check" CHECK (
  ("reason" = 'ATTENDANCE_AWARD' AND "delta" = "pointsSnapshot")
  OR
  ("reason" = 'ATTENDANCE_REVERSAL' AND "delta" = -"pointsSnapshot")
);

-- Unique and lookup indexes
CREATE UNIQUE INDEX "Challenge_key_key" ON "Challenge"("key");
CREATE INDEX "Challenge_isActive_idx" ON "Challenge"("isActive");
CREATE UNIQUE INDEX "Challenge_one_active_idx" ON "Challenge" ((true)) WHERE "isActive" = true;
CREATE INDEX "Class_challengeId_idx" ON "Class"("challengeId");
CREATE INDEX "ChallengeUserTotal_challengeId_points_idx" ON "ChallengeUserTotal"("challengeId", "points");
CREATE INDEX "ChallengeUserTotal_userId_challengeId_idx" ON "ChallengeUserTotal"("userId", "challengeId");
CREATE UNIQUE INDEX "ChallengeBookingAward_challengeId_bookingId_key" ON "ChallengeBookingAward"("challengeId", "bookingId");
CREATE INDEX "ChallengeBookingAward_challengeId_userId_idx" ON "ChallengeBookingAward"("challengeId", "userId");
CREATE INDEX "ChallengeBookingAward_classId_idx" ON "ChallengeBookingAward"("classId");
CREATE UNIQUE INDEX "ChallengePointLedger_idempotencyKey_key" ON "ChallengePointLedger"("idempotencyKey");
CREATE UNIQUE INDEX "ChallengePointLedger_challengeId_bookingId_reason_cycle_key" ON "ChallengePointLedger"("challengeId", "bookingId", "reason", "cycle");
CREATE INDEX "ChallengePointLedger_challengeId_userId_createdAt_idx" ON "ChallengePointLedger"("challengeId", "userId", "createdAt");
CREATE INDEX "ChallengePointLedger_challengeId_classId_idx" ON "ChallengePointLedger"("challengeId", "classId");
CREATE INDEX "ChallengePointLedger_bookingId_idx" ON "ChallengePointLedger"("bookingId");

-- Foreign keys
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Class" ADD CONSTRAINT "Class_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeUserTotal" ADD CONSTRAINT "ChallengeUserTotal_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeUserTotal" ADD CONSTRAINT "ChallengeUserTotal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeBookingAward" ADD CONSTRAINT "ChallengeBookingAward_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeBookingAward" ADD CONSTRAINT "ChallengeBookingAward_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeBookingAward" ADD CONSTRAINT "ChallengeBookingAward_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengeBookingAward" ADD CONSTRAINT "ChallengeBookingAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengePointLedger" ADD CONSTRAINT "ChallengePointLedger_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengePointLedger" ADD CONSTRAINT "ChallengePointLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengePointLedger" ADD CONSTRAINT "ChallengePointLedger_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengePointLedger" ADD CONSTRAINT "ChallengePointLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChallengePointLedger" ADD CONSTRAINT "ChallengePointLedger_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
