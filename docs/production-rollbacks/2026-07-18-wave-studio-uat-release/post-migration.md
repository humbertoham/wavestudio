# Production database migration report — 2026-07-19

Status: production database migrations completed; application deployment is handled separately.

## Execution

- Operator approval phrase received before any write.
- Immediate pre-migration timestamp: `2026-07-19T18:57:30.410Z`.
- Migration execution started: `2026-07-19T18:57:46.749Z`.
- Migration execution completed: `2026-07-19T18:57:53.144Z`.
- Command executed exactly once: `npx prisma migrate deploy` (Windows command shim: `npx.cmd`).
- Exit code: `0`.
- No migration error, DDL timeout, or failed-migration state was observed.

Applied in order:

1. `20260630000000_add_wellhub_plan_affiliation_confirmation`
2. `20260713000000_add_wellhub_credit_traceability`
3. `20260713010000_add_challenge`
4. `20260713020000_add_wellhub_plan_confirmation`
5. `20260717010000_add_class_deleted_at`
6. `20260718010000_add_challenge_point_adjustment`
7. `20260718020000_add_wellhub_session_transition`

Post-migration `prisma migrate status` reports the database schema up to date, with 20 finished migrations and no failed or pending migration.

## Integrity verification

The following safe aggregates were identical immediately before and after migration:

| Aggregate | Before | After |
| --- | ---: | ---: |
| Users | 147 | 147 |
| Classes | 242 | 242 |
| Bookings | 1,167 | 1,167 |
| Attended bookings | 550 | 550 |
| Pack purchases | 268 | 268 |
| Remaining classes total | 2,231 | 2,231 |
| Payments | 188 | 188 |
| Payment amount total | 105,341 | 105,341 |
| Token-ledger rows | 1,838 | 1,838 |
| Token delta total | 2,231 | 2,231 |

All expected tables, columns, enums, indexes, checks, unique constraints, and foreign keys exist. Read-only Prisma ORM smoke checks succeeded for users, classes, bookings, purchases, token ledger, Challenge, and WellHub confirmation.

PostgreSQL truncated the long session-recovery index identifier to 63 bytes while preserving its intended three-column definition. The release Prisma schema was aligned with the actual migrated schema by:

- declaring the existing `User(affiliation, wellhubPlan)` index;
- declaring the intended `Class.challenge` `onDelete: Restrict` action;
- mapping the session-recovery index to its actual PostgreSQL identifier.

After this metadata alignment, Prisma reports no difference between the production database and release datamodel. No additional database write was required.

## Release validation after migration

- Prisma generate and validate passed.
- 265 tests passed; 25 environment-dependent tests remained skipped.
- Production build passed.
- `tsc --noEmit` passed.

No seed, cron job, WellHub reset/campaign, manual customer-data mutation, restore, application deployment, `main` modification, or Vercel interaction occurred.

## Recovery posture

The operator identified the local connection as production and manages Neon Backup & Restore manually. Restore availability, retention, and the exact restore target were not programmatically verified. Prefer a forward fix or application rollback while leaving this additive schema in place. A Neon restore remains an operator-approved emergency action because it can remove legitimate writes made after the selected restore point.
