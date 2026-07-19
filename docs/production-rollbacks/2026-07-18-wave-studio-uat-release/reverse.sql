-- DESTRUCTIVE CANDIDATE ONLY. DO NOT RUN AS PART OF NORMAL DEPLOYMENT.
-- Preferred rollback: restore the previous Vercel deployment and leave the
-- additive schema in place. This file is intentionally blocked so that merely
-- executing it cannot drop production data. A DBA must review the actual
-- partial schema, remove the exception, and obtain separate approval.

BEGIN;

DO $$
BEGIN
  RAISE EXCEPTION 'BLOCKED: destructive reverse SQL requires incident-specific DBA review and approval';
END
$$;

-- 20260718020000_add_wellhub_session_transition
DROP INDEX IF EXISTS "WellhubPlanConfirmation_userId_status_sessionRecoveryExpiresAt_idx";
ALTER TABLE "WellhubPlanConfirmation"
  DROP CONSTRAINT IF EXISTS "WellhubPlanConfirmation_auth_version_transition_check",
  DROP COLUMN IF EXISTS "authVersionBefore",
  DROP COLUMN IF EXISTS "authVersionAfter",
  DROP COLUMN IF EXISTS "sessionRecoveryExpiresAt";

-- 20260718010000_add_challenge_point_adjustment
DROP TABLE IF EXISTS "ChallengePointAdjustment";

-- 20260717010000_add_class_deleted_at
DROP INDEX IF EXISTS "Class_deletedAt_date_idx";
ALTER TABLE "Class" DROP COLUMN IF EXISTS "deletedAt";

-- 20260713020000_add_wellhub_plan_confirmation
-- WARNING: destroys confirmation/audit history and auth-version state.
DROP TABLE IF EXISTS "WellhubPlanConfirmation";
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "authVersion",
  DROP COLUMN IF EXISTS "wellhubPlanConfirmationRequired",
  DROP COLUMN IF EXISTS "wellhubPlanConfirmationRequestedAt",
  DROP COLUMN IF EXISTS "wellhubPlanConfirmedAt",
  DROP COLUMN IF EXISTS "wellhubPlanConfirmationCampaign";
DROP TYPE IF EXISTS "WellhubPlanConfirmationStatus";
-- TokenReason.USER_WELLHUB_PLAN_CONFIRMATION is intentionally retained.
-- PostgreSQL enum-value removal requires recreating the type and is not worth
-- the lock/data risk for an application rollback.

-- 20260713010000_add_challenge
-- WARNING: destroys all Challenge data, awards, totals, and ledger history.
ALTER TABLE "Class" DROP CONSTRAINT IF EXISTS "Class_challengeId_fkey";
ALTER TABLE "Class"
  DROP CONSTRAINT IF EXISTS "Class_challengePoints_check",
  DROP CONSTRAINT IF EXISTS "Class_challengeEligibility_check";
DROP INDEX IF EXISTS "Class_challengeId_idx";
DROP TABLE IF EXISTS "ChallengePointLedger";
DROP TABLE IF EXISTS "ChallengeBookingAward";
DROP TABLE IF EXISTS "ChallengeUserTotal";
DROP TABLE IF EXISTS "Challenge";
ALTER TABLE "Class"
  DROP COLUMN IF EXISTS "challengeId",
  DROP COLUMN IF EXISTS "challengePoints",
  DROP COLUMN IF EXISTS "challengeEligibleAt",
  DROP COLUMN IF EXISTS "challengeActivationVersion";
DROP TYPE IF EXISTS "ChallengePointReason";

-- 20260713000000_add_wellhub_credit_traceability
-- WARNING: destroys idempotency keys and credit traceability metadata.
DROP INDEX IF EXISTS "TokenLedger_idempotencyKey_key";
DROP INDEX IF EXISTS "TokenLedger_userId_reason_createdAt_idx";
ALTER TABLE "TokenLedger"
  DROP COLUMN IF EXISTS "idempotencyKey",
  DROP COLUMN IF EXISTS "metadata";
-- TokenReason.ADMIN_WELLHUB_PLAN_CHANGE is intentionally retained for the same
-- enum safety reason described above.

-- 20260630000000_add_wellhub_plan_affiliation_confirmation
-- WARNING: destroys users' selected WellHub plans and confirmation timestamps.
DROP INDEX IF EXISTS "User_affiliation_wellhubPlan_idx";
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "wellhubPlan",
  DROP COLUMN IF EXISTS "affiliationConfirmedAt";
DROP TYPE IF EXISTS "WellhubPlan";

COMMIT;
