-- Bind session recovery to the exact auth-version transition performed by a
-- completed WellHub confirmation. Existing confirmations remain valid audit
-- records but are not eligible for stale-session recovery.
ALTER TABLE "WellhubPlanConfirmation"
  ADD COLUMN "authVersionBefore" INTEGER,
  ADD COLUMN "authVersionAfter" INTEGER,
  ADD COLUMN "sessionRecoveryExpiresAt" TIMESTAMP(3);

ALTER TABLE "WellhubPlanConfirmation"
  ADD CONSTRAINT "WellhubPlanConfirmation_auth_version_transition_check"
  CHECK (
    ("authVersionBefore" IS NULL AND "authVersionAfter" IS NULL AND "sessionRecoveryExpiresAt" IS NULL)
    OR
    ("authVersionBefore" IS NOT NULL AND "authVersionAfter" = "authVersionBefore" + 1 AND "sessionRecoveryExpiresAt" IS NOT NULL)
  );

CREATE INDEX "WellhubPlanConfirmation_userId_status_sessionRecoveryExpiresAt_idx"
  ON "WellhubPlanConfirmation"("userId", "status", "sessionRecoveryExpiresAt");
