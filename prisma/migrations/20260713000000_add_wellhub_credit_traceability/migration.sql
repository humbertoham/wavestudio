ALTER TYPE "public"."TokenReason" ADD VALUE 'ADMIN_WELLHUB_PLAN_CHANGE';

ALTER TABLE "public"."TokenLedger"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "metadata" JSONB;

CREATE UNIQUE INDEX "TokenLedger_idempotencyKey_key" ON "public"."TokenLedger"("idempotencyKey");

CREATE INDEX "TokenLedger_userId_reason_createdAt_idx"
ON "public"."TokenLedger"("userId", "reason", "createdAt");
