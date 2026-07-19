# Validation and recovery runbook

## Validation limitation: no production clone

No separate rehearsal database is available for this release. Do not run integration fixtures or migration rehearsal against the sole production `DATABASE_URL`. The operator accepts this limitation and will manage Neon Backup & Restore manually.

Completed safe validation:

- Production migration history and schema metadata were inspected read-only.
- A live-to-current-`main` Prisma diff reported no schema difference.
- Exactly seven additive release migrations are pending and no failed migration exists.
- `npm ci`, Prisma generate/validate, 265 tests, the production build, and TypeScript passed.
- Twenty-five environment-dependent database tests remained skipped; they were not pointed at production.

Before authorization, the operator must manually confirm Backup & Restore availability. No recovery point or retention window is programmatically certified by this package.

## Application rollback

Before release, record the current production deployment URL/ID and aliases in the private release log. Do not place protected or internal URLs in this repository.

Preferred incident action when the schema migration succeeded and the app is unhealthy:

```text
vercel rollback <previous-production-deployment>
vercel rollback status
```

Equivalent dashboard action: select the previous eligible Production deployment and use Instant Rollback. Keep in mind that Vercel restores the prior build's configuration and cron configuration; environment-variable changes made after that build are not automatically incorporated. After rollback, verify the production domain, homepage, static assets, login/logout, user/admin/coach access, calendar/class detail, existing bookings/packages, and payment/webhook route availability. Check production logs for HTTP 5xx, Prisma errors, authentication loops, and database connection failures.

## Rollback decision tree

### Application error; schema is healthy and backward-compatible

1. Instant Rollback to the recorded deployment.
2. Leave the additive database schema in place.
3. Verify critical flows and logs.
4. Prepare a forward fix.

### Migration fails before new code is live

1. Stop deployment and inspect `_prisma_migrations` plus the actual schema.
2. Determine whether PostgreSQL rolled the migration transaction back.
3. Do not rerun blindly and do not use `migrate resolve` without a reviewed explanation.
4. Prefer a corrected forward migration. Use reviewed reverse SQL only if no new feature data exists and the exact partial state is known.
5. Consider Neon restore only after measuring all writes since the recovery timestamp.

### New code wrote incompatible or corrupt data

1. Roll back/disable application traffic and preserve logs with an incident timestamp.
2. Measure all post-recovery-point writes.
3. Choose a forward fix, targeted repair, reviewed reverse migration, or full restore.
4. Require separate explicit approval for destructive SQL or full database restore.

### Severe incident requiring operator-managed Neon restore

1. Record the chosen UTC restore timestamp and minimize writes.
2. Coordinate application traffic rollback through the separately managed application process.
3. Use Neon Time Travel Assist/read-only checks to verify the selected point.
4. Restore only through the operator-approved Neon workflow and preserve the pre-restore state where supported.
5. Wait for all Neon operations to complete before reconnecting.
6. Recheck migration history and critical aggregates; reconcile legitimate post-restore-point writes where possible.
7. Run the complete smoke suite before reopening traffic.

## Production smoke checklist

- Homepage and static assets.
- Login and logout.
- Normal USER, ADMIN, and COACH authorization boundaries.
- `/clases`, class detail, and existing booking/package reads.
- Class deletion only with a deliberately created disposable class.
- WellHub confirmation only with an explicitly approved safe test account; verify redirect to `/clases`.
- Challenge admin read; point edit only on an approved test account.
- Cron endpoint rejects invalid authorization. Do not invoke authorized credit restoration outside its schedule.
- Mercado Pago/public webhook route availability without creating a payment.
- Logs: HTTP 5xx, Prisma/migration errors, DB connection errors, 401/428 loops, WellHub failures, duplicate-ledger warnings, cron authorization failures, and material latency regressions.

## Required private release record

- Previous and released `main` commits; UAT and release merge commits.
- Previous and new Vercel production deployment IDs and aliases.
- Migration start/end UTC times and redacted status output.
- Neon recovery branch/snapshot ID, pre-migration UTC timestamp, and retention/expiration.
- Clone rehearsal, local validation, production smoke, and monitoring results.
- Whether rollback was used and current rollback targets.
- Explicit confirmations that no seed ran, no cron/reset campaign was triggered, and no unrelated customer data was modified.
