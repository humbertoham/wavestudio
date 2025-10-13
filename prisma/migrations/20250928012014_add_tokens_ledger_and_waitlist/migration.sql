/*
  Warnings:

  - Added the required column `updatedAt` to the `PackPurchase` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."TokenReason" AS ENUM ('PURCHASE_CREDIT', 'BOOKING_DEBIT', 'CANCEL_REFUND', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "public"."PackHighlight" AS ENUM ('POPULAR', 'BEST');

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "packPurchaseId" TEXT,
ADD COLUMN     "refundToken" BOOLEAN;

-- AlterTable
ALTER TABLE "public"."Class" ADD COLUMN     "cancelBeforeMin" INTEGER,
ADD COLUMN     "isCanceled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "public"."Pack" ADD COLUMN     "classesLabel" TEXT,
ADD COLUMN     "description" JSONB,
ADD COLUMN     "highlight" "public"."PackHighlight";

-- AlterTable
ALTER TABLE "public"."PackPurchase" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "public"."TokenLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packPurchaseId" TEXT,
    "bookingId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" "public"."TokenReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Waitlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenLedger_userId_packPurchaseId_idx" ON "public"."TokenLedger"("userId", "packPurchaseId");

-- CreateIndex
CREATE INDEX "TokenLedger_bookingId_idx" ON "public"."TokenLedger"("bookingId");

-- CreateIndex
CREATE INDEX "Waitlist_classId_position_idx" ON "public"."Waitlist"("classId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Waitlist_userId_classId_key" ON "public"."Waitlist"("userId", "classId");

-- CreateIndex
CREATE INDEX "Booking_classId_idx" ON "public"."Booking"("classId");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "public"."Booking"("userId");

-- CreateIndex
CREATE INDEX "PackPurchase_userId_expiresAt_idx" ON "public"."PackPurchase"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_packPurchaseId_fkey" FOREIGN KEY ("packPurchaseId") REFERENCES "public"."PackPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TokenLedger" ADD CONSTRAINT "TokenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TokenLedger" ADD CONSTRAINT "TokenLedger_packPurchaseId_fkey" FOREIGN KEY ("packPurchaseId") REFERENCES "public"."PackPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TokenLedger" ADD CONSTRAINT "TokenLedger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Waitlist" ADD CONSTRAINT "Waitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Waitlist" ADD CONSTRAINT "Waitlist_classId_fkey" FOREIGN KEY ("classId") REFERENCES "public"."Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
