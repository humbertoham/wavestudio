# Wave Studio production release package — 2026-07-18

Status: **release candidate only; production release is not authorized**.

This package was prepared for the normal merge of validated UAT into the production source branch. It deliberately does not contain credentials, connection strings, deployment URLs, branch IDs, or customer identifiers.

## Release identity

- Current production source commit (`origin/main` at audit time): `de3f8c89e778cc5e399bf6114af5b00c41c7e8ed`
- UAT source commit: `e2c4de101154717730fecbdb125db373e9e172fa`
- Development source commit: `338db564da547cec662961bf1f2b31f0a67f8039`
- Local release branch: `release/production-2026-07-18`
- Release commit: record the final local commit after all validation succeeds

`main` and `uat` had diverged from merge base `14e81a4f765e3d05ef14fb91583159efa0aac6d4`. The release candidate uses a normal merge, retaining the production-only COACH authorization and Monterrey package-expiration behavior while adding the complete validated UAT feature set. The temporary `production-forbidden-schema.test.ts` guard was removed because this release intentionally introduces the schema it formerly prohibited.

## Pending production migrations

The configured read-only database preflight reported 13 applied migrations, no failed/rolled-back migration rows, and exactly these seven pending migrations. Its observed schema matches `main`, but the database's identity as the Neon production root branch could not be independently established from this workstation.

| Migration | Change | Risk and lock assessment | Compatibility and rollback |
| --- | --- | --- | --- |
| `20260630000000_add_wellhub_plan_affiliation_confirmation` | Adds `WellhubPlan`, two nullable `User` columns, and one index. | Additive. Brief `ACCESS EXCLUSIVE` table lock for `ALTER TABLE`; index scans approximately 147 users. No rewrite/backfill expected. | Old code ignores it. Reverse drops user-entered plan/confirmation data and is not preferred. |
| `20260713000000_add_wellhub_credit_traceability` | Adds one `TokenReason` value, two nullable `TokenLedger` columns, a unique nullable key, and lookup index. | Additive. Brief enum/table locks; two indexes scan approximately 1,822 ledger rows. Existing nulls do not violate uniqueness. | Old code ignores it. PostgreSQL enum-value removal is intentionally omitted from reverse SQL. Dropping columns loses traceability. |
| `20260713010000_add_challenge` | Adds challenge enum/tables; adds four nullable `Class` columns, checks, indexes, and foreign keys. | Additive but largest migration. Brief `ACCESS EXCLUSIVE` locks on `Class`; checks validate approximately 242 all-null historical class rows. New-table indexes/FKs start empty. | Old code ignores it. Reverse destroys all challenge history and is high risk after feature use. |
| `20260713020000_add_wellhub_plan_confirmation` | Adds a confirmation status enum, five `User` fields, a confirmation table/indexes/FK, and a token reason. | Additive. Required fields use constant defaults (`authVersion=0`, required flag `false`); on PostgreSQL 17 these are expected to avoid a full table rewrite. Other fields are nullable. | Old code ignores it. Reverse loses confirmation audit history and session-version state. Token enum value remains if code is rolled back. |
| `20260717010000_add_class_deleted_at` | Adds nullable `Class.deletedAt` plus an index. | Additive. Brief table lock and small index scan. | Old code ignores it. Reverse loses class archival state and can make archived classes visible to old/new code. |
| `20260718010000_add_challenge_point_adjustment` | Adds the adjustment audit table, checks, indexes, and foreign keys. | Additive; all constraints apply to a new empty table. | Old code ignores it. Reverse destroys admin adjustment audit records. |
| `20260718020000_add_wellhub_session_transition` | Adds three nullable confirmation transition fields, an all-null-or-valid check, and an index. | Additive. Existing rows satisfy the all-null branch. Brief locks/index scan on the confirmation table. | The previous app safely ignores the nullable fields. Prefer application-only rollback and leave this schema expanded. |

Observed aggregate row estimates used for review: `User` 147, `Class` 242, `Booking` 1,157, `TokenLedger` 1,822, `PackPurchase` 264, and `Payment` 184. No new target objects or enum values were present before migration, and the historical `20260630000000` SQL is byte-identical to its earlier main-branch version but is not recorded as applied.

No migration drops or rewrites a populated production object, seeds data, changes credit balances, or starts the WellHub confirmation campaign. New application code requires the expanded schema; therefore migrate first and deploy code second. The old application is compatible with the expanded schema, so expected application downtime is zero, subject to the short DDL/index locks above.

## Mandatory unresolved production checks

Do not approve or execute the release until all items below are recorded by an operator with access to the linked Vercel and Neon projects:

- Confirm the database checked during preflight is the actual production Neon root branch.
- Confirm the production Neon branch ID/name, restore window, retention, and protected-branch status.
- Create and query a pre-release branch/snapshot at the exact pre-migration UTC timestamp; record its ID and expiration without its connection string.
- Clone production at that recovery point and complete the migration rehearsal described in `validation.md`.
- Confirm the current Vercel production deployment ID/URL, aliases, plan, and linked Git production branch.
- Confirm required Production environment variables exist, especially `CRON_SECRET`, without displaying their values.
- Confirm Production uses only the production Neon database and Preview/UAT do not use it.
- Confirm there is no deployment already running and no unexpected change to `origin/main` or `origin/uat`.

This workstation has no linked `.vercel/project.json`, Vercel CLI, Neon CLI, `psql`, or Neon credentials. Those checks cannot be inferred from local `.env` files and must not be marked complete from this package.

## Deployment order after the approval gate

1. Reconfirm source commits and the current production deployment.
2. Verify the Neon recovery point and queryable production clone.
3. Through the approved production release job, run `npx prisma migrate deploy` once against production.
4. Immediately run `npx prisma migrate status` and verify all seven migrations finished successfully.
5. Merge the reviewed release branch into `main` without squashing or force-pushing; push `main`.
6. Monitor Vercel and verify the production domain resolves to the new commit.
7. Perform the non-destructive smoke tests in `validation.md`.
8. Do not run a seed, WellHub reset campaign, or manual monthly-credit cron invocation.

## Data-loss warning

Vercel Instant Rollback changes application routing/code only; it does not undo database changes. Neon point-in-time restore reverts database writes after the selected timestamp and can therefore remove legitimate bookings, purchases, payments, credits, registrations, attendance changes, and administrative work created after release. Prefer a forward fix or Vercel application rollback while leaving the additive schema in place. Use full database restore only after measuring and reconciling post-snapshot writes.

References: [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback), [Vercel rollback CLI](https://vercel.com/docs/cli/rollback), [Neon restore-window settings](https://neon.com/docs/manage/projects), and [Neon point-in-time restore overview](https://neon.com/blog/announcing-point-in-time-restore).
