/*
  Warnings:

  - A unique constraint covering the columns `[paymentId]` on the table `PackPurchase` will be added. If there are existing duplicate values, this will fail.
  - Made the column `affiliation` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "public"."PaymentProvider" AS ENUM ('MERCADOPAGO');

-- CreateEnum
CREATE TYPE "public"."PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."CheckoutStatus" AS ENUM ('CREATED', 'OPEN', 'EXPIRED', 'COMPLETED', 'CANCELED');

-- DropIndex
DROP INDEX "public"."Booking_userId_classId_key";

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."Class" ADD COLUMN     "creditCost" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."PackPurchase" ADD COLUMN     "paymentId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ALTER COLUMN "affiliation" SET NOT NULL;

-- CreateTable
CREATE TABLE "public"."Payment" (
    "id" TEXT NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "status" "public"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "userId" TEXT,
    "mpPreferenceId" TEXT,
    "mpPaymentId" TEXT,
    "mpInitPoint" TEXT,
    "mpExternalRef" TEXT,
    "mpPayerEmail" TEXT,
    "mpRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CheckoutLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "public"."CheckoutStatus" NOT NULL DEFAULT 'CREATED',
    "packId" TEXT NOT NULL,
    "userId" TEXT,
    "paymentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "successUrl" TEXT,
    "failureUrl" TEXT,
    "pendingUrl" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,

    CONSTRAINT "CheckoutLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookLog" (
    "id" TEXT NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "eventType" TEXT,
    "deliveryId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedOk" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_provider_status_idx" ON "public"."Payment"("provider", "status");

-- CreateIndex
CREATE INDEX "Payment_mpPreferenceId_idx" ON "public"."Payment"("mpPreferenceId");

-- CreateIndex
CREATE INDEX "Payment_mpPaymentId_idx" ON "public"."Payment"("mpPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLink_code_key" ON "public"."CheckoutLink"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLink_paymentId_key" ON "public"."CheckoutLink"("paymentId");

-- CreateIndex
CREATE INDEX "CheckoutLink_status_expiresAt_idx" ON "public"."CheckoutLink"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "WebhookLog_provider_deliveryId_idx" ON "public"."WebhookLog"("provider", "deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "PackPurchase_paymentId_key" ON "public"."PackPurchase"("paymentId");

-- AddForeignKey
ALTER TABLE "public"."PackPurchase" ADD CONSTRAINT "PackPurchase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutLink" ADD CONSTRAINT "CheckoutLink_packId_fkey" FOREIGN KEY ("packId") REFERENCES "public"."Pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutLink" ADD CONSTRAINT "CheckoutLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CheckoutLink" ADD CONSTRAINT "CheckoutLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
