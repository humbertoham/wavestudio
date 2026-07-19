-- Keep calendar deletion separate from class cancellation while preserving
-- booking, attendance, waitlist, Challenge, and token-ledger relations.
ALTER TABLE "Class" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Class_deletedAt_date_idx" ON "Class"("deletedAt", "date");
