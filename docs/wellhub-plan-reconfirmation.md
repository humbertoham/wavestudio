# Forced WellHub plan reconfirmation

This runbook describes the reusable campaign command and the blocking user flow. Applying the database migration alone does not flag users.

## Authentication and blocking

WAVE uses a custom, stateless JWT in the HTTP-only `session` cookie. Each JWT now contains `sessionVersion`; authenticated requests compare it with `User.authVersion`. The campaign command increments the version only for newly included users, making their older cookies unusable.

The database remains the source of truth. After login, the Node-runtime `src/proxy.ts` entry delegates to the database-backed access handler and redirects a flagged account to `/actualizar-plan-wellhub`. The rule applies to users, coaches, and administrators. Protected APIs return HTTP 428 with `WELLHUB_PLAN_CONFIRMATION_REQUIRED`.

While flagged, only these surfaces are available:

- the WellHub confirmation page;
- `GET /api/wellhub/plans`;
- `POST /api/users/me/wellhub-plan-confirmation`;
- login/session/logout and password-recovery routes;
- static assets.

All other application pages and APIs are blocked server-side.

## Selection rules

The command uses persisted `User.affiliation = WELLHUB`. It does not filter by role or `bookingBlocked`, and it does not change those fields. This repository has no soft-delete, anonymized, inactive, or machine-account fields, so no additional lifecycle exclusion is possible; the summary reports `excludedDeletedOrAnonymized: 0`.

The command changes only the campaign flags and `authVersion`. Existing `wellhubPlan`, packs, purchases, ledger entries, credits, bookings, Challenge points, roles, and booking-block state are unchanged. Users who already require confirmation are reported separately and are not updated or version-incremented again.

`--user-id` is an optional controlled-fixture cohort selector for dev/UAT verification. Omit it for the intended all-applicable-user campaign.

## Command

The correctly spelled command is:

```text
npm run wellhub:reset-confirmations -- --target=<dev|uat> --campaign=<stable-id> [--apply]
```

It defaults to dry run. A campaign must use 3–100 letters, numbers, dots, underscores, or hyphens. Each user/campaign pair is unique, so rerunning the same campaign does not re-flag the user or increment `authVersion` again. A later campaign creates a new audit row and can require confirmation again.

Examples:

```text
# Dev dry run
npm run wellhub:require-plan-confirmation -- --target=dev --campaign=wellhub-plan-reconfirmation-2026-01

# Dev apply
npm run wellhub:require-plan-confirmation -- --target=dev --campaign=wellhub-plan-reconfirmation-2026-01 --apply

# UAT dry run
npm run wellhub:require-plan-confirmation -- --target=uat --campaign=wellhub-plan-reconfirmation-2026-01

# Controlled UAT fixture only
npm run wellhub:require-plan-confirmation -- --target=uat --campaign=wellhub-plan-reconfirmation-2026-01-uat-smoke --user-id=<fixture-user-id> --apply
```

`wellhub:require-plan-confirmation` remains an alias for the same command. The script loads only the target-specific local file and key:

- dev: `.env.dev.local` / `DATABASE_URL_DEV_BRANCH`;
- UAT: `.env.uat.local` / `DATABASE_URL_UAT_BRANCH`;
- production is not an accepted target.

It rejects unknown or production targets, missing/placeholder URLs, an optional `WAVE_DATABASE_TARGET` marker mismatch, a database fingerprint matching another configured environment, and production-looking host/database names. Output includes only the target, redacted database identity, cohort kind, and aggregate counts; it never prints the connection string, credentials, email, password, cookie, or JWT.

Each apply batch selects only WellHub users who do not already require confirmation, creates campaign records, increments `authVersion` exactly once, and updates the flags in one transaction. A failed batch rolls back fully, is reported in `failed`, and can be safely retried. The summary includes eligible, already-required, would-modify, modified, sessions-invalidated, and post-apply remaining counts. Successfully committed earlier batches remain idempotent.

## Confirmation transaction and credits

`POST /api/users/me/wellhub-plan-confirmation` validates the authenticated user, persisted WellHub affiliation, required flag, active campaign record, and exact canonical plan enum. It then runs one serializable transaction (with serialization retries) that:

1. calls the existing corporate-credit synchronization service;
2. saves the selected plan;
3. adjusts only unused internal WellHub credits;
4. writes a `USER_WELLHUB_PLAN_CONFIRMATION` token-ledger entry with a unique user/campaign key;
5. completes the campaign audit;
6. clears the required flag and records the confirmation time.

Same-plan confirmation writes a zero-delta audit without granting credits. Upgrades add only the remaining entitlement difference. Downgrades remove only unused internal WellHub packs. Paid/manual/unrelated packs are never selected for decrement. A null legacy plan accounts for identifiable unused legacy WellHub packs before adding or removing a difference. Any error rolls back the plan, credits, ledger, audit, and unblock.

The persisted selected plan is automatically used by the existing monthly renewal.

After the confirmation transaction commits, the endpoint refreshes the signed
session cookie and returns `/clases` as the canonical destination. The client
then performs an uncached `/api/auth/me` refresh, verifies that
`wellhubPlanConfirmationRequired` is false, and uses history-replacing
navigation to `/clases`. The initial affiliation flow uses the same refresh and
destination contract. Failed database/API updates never invoke navigation.

## Admin visibility

Administrators can open `/admin/wellhub-confirmaciones` (linked from the admin panel) and select a campaign. The server-paginated report shows included, pending, completed, and detectable inconsistent totals, plus requested/confirmed dates, current and confirmed plan, credit delta, and resulting balance. Regular users and coaches cannot access the report. A flagged administrator must first complete their own confirmation and receives no bypass.

## Data model

Migration: `20260713020000_add_wellhub_plan_confirmation`.

Additive `User` fields:

- `authVersion` (default `0`);
- `wellhubPlanConfirmationRequired` (default `false`);
- `wellhubPlanConfirmationRequestedAt`;
- `wellhubPlanConfirmedAt`;
- `wellhubPlanConfirmationCampaign`.

`WellhubPlanConfirmation` retains one immutable campaign/user identity plus pending/completed status, request and confirmation dates, old/new plan and entitlement, applied delta, resulting balance, source, ledger ID, and idempotency key. `TokenReason.USER_WELLHUB_PLAN_CONFIRMATION` separates user confirmation history from admin changes.

## Operational checks

Before applying a campaign:

1. run database migration status for the intended target;
2. run the all-user dry run and review `eligibleUsers`/`wouldFlag`;
3. confirm the impact window and support coverage;
4. use a controlled fixture campaign first in dev/UAT;
5. apply the approved campaign;
6. monitor `/admin/wellhub-confirmaciones?campaign=<id>`;
7. rerun the same campaign only if a batch reported failures.

There is no automatic campaign expiry. A user whose affiliation changes away from WellHub while pending is reported as inconsistent and requires an administrator to resolve their persisted state deliberately.
