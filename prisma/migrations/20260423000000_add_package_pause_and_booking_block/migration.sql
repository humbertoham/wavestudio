-- AlterTable
ALTER TABLE "public"."PackPurchase"
ADD COLUMN     "pausedDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pausedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."User"
ADD COLUMN     "bookingBlocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingBlockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."BookingBlockLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingBlockLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingBlockLog_userId_createdAt_idx" ON "public"."BookingBlockLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."BookingBlockLog" ADD CONSTRAINT "BookingBlockLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
