# Monthly Unlimited production release candidate — October 20, 2026

## Status and release identity

Candidate branch: `release/monthly-unlimited-production` in the separate `wavestudio-monthly-production` worktree. Original MAIN is `a9b85f3c2c3f7114bd5a7fe9867e86b90a39b0b7`; original DEV is `c0ee7213cc5cf7e24986660f6ae7122f97101fe6`; UAT is `af161a20b4c6fecd3c67a4a06e1b27f7a3ef433b`.

This is a locally validated candidate, **not a deployed production release**. No production database connection, migration, customer mutation, MAIN integration or remote push has been performed. The user paused deployment and prohibited production-secret access during CLI authentication. Those restrictions remain in effect until explicitly changed.

Authenticated Vercel CLI checks now confirm account `humbertoham`, team `humberto-hams-projects`, and project `wavestudio` (`prj_zTGn4WL9QQfZK9wVAqfGxwyYCyBJ`). The configured build is `npm run build`. Inspection of the live production alias `https://www.wavestudio.mx` resolves to READY production deployment `dpl_4gpnF4dvbAftT2dybjXzuC1XqtaT`, URL `https://wavestudio-3dhq67rkz-humberto-hams-projects.vercel.app`. Existing aliases include `wavestudio.mx` and the git-main alias. This deployment is also the Vercel status target associated with original MAIN. No settings were changed, no project created/relinked, and no production environment values were retrieved.

## Migration fix and historical semantics

DEV's base migration assumes the excluded Wellhub Booking rollout already added `Booking.source`. The approved replacement is:

1. `20261011000001_add_monthly_unlimited_production`
2. `20261011010000_guard_unlimited_purchase_history`
3. `20261011020000_snapshot_existing_purchase_labels`

The new base adds only the monthly package enum/configuration, entitlement snapshots and revocation fields, booking entitlement attribution, UnlimitedUsage, foreign keys, constraints and indexes. It contains no Booking.source reference and does not install Wellhub persistence. The original DEV base is absent from this candidate and remains unchanged on DEV. The latter two migrations are unchanged from DEV and depend only on the new monthly objects and the existing MAIN schema.

The original source-dependent booking UPDATEs were removed. Existing named guests, anonymous rows without names, member bookings, admin-owned bookings, cancellations, quantities and attendance are not inferred or rewritten. All historical rows receive the neutral CREDITS default on the new attribution column; this creates no debit, payment or ledger entry. Newly created guests are explicitly attributed by the application. The reserved WELLHUB attribution enum label is retained for enum compatibility; it installs no provider integration.

The existing purchase snapshot backfill captures catalog labels and recorded payment amounts where available, without changing original columns. Snapshots and later unlimited claims receive the unchanged guard triggers.

## Migration lineage

See [the lineage policy](monthly-unlimited-production-lineage.md). A required source guard pins all 21 MAIN baseline migrations plus the three approved additions, rejects the original DEV base, and checks source hashes. Both the production-style build and supported migrate-deploy command run this guard.

Existing DEV and production histories must remain separate until explicitly reconciled. Later surgical promotions keep the production base and omit DEV's base; no falsely applied migrations or rewritten checksums are allowed. A future Wellhub rollout must introduce only its then-missing structures through a separately reviewed migration, preserve existing monthly objects and rehearse the combined history. Any future broad integration must deliberately reconcile both real histories before changing the pinned manifest.

## Included and excluded scope

Included: monthly package creation/editing and catalog display; trusted Mercado Pago checkout/fulfillment with immutable terms; zero-credit unlimited grants; class-month/timezone eligibility; one consumed daily claim across all grants; credit fallback/mixed seats; four-hour cancellation handling; waitlist eligibility; user history; ADMIN manual assignment/revocation with audit; class-day protection; tests and migration safeguards.

The review also fixed one monthly-specific edge: a genuine provider refund/chargeback received after ADMIN revocation now processes the normal payment-reversal policy exactly once. A separate zero-delta marker preserves the entire original admin-revoked purchase and audit. ADMIN revocation itself still does not cancel or refund anything. Standard-payment reversal behavior is unchanged.

Excluded: full Wellhub Access/Booking persistence, synchronization and flags; unrelated DEV schema/migrations; authentication/authorization redesign; corporate/TotalPass allocations or renewal changes; accounting/payroll removals; unrelated admin/challenge/marketing redesign; environment/secret changes; runtime payment simulators and DEV seeds. Production auth, admin authorization helpers, payroll/accounting services, environment handling, lockfile and existing Wellhub webhook stub remain unchanged. Mixed UI/class routes retain MAIN accounting/payroll/challenge behavior.

## Validation

- Final full suite: **590 passed, 0 failed, 0 skipped; 76 files**.
- Final focused suite: **189 passed, 0 failed, 0 skipped; 7 files**.
- Prisma generate/validate and TypeScript: passed.
- Production-style build: passed with isolated fixture credentials; existing baseline-browser-mapping age warning only.
- Dependency installation: clean `npm ci --ignore-scripts`; no dependency or lockfile changes.
- Lineage, diff and secret checks: passing; final delivery check runs after documentation is complete.
- Browser visual QA: unavailable; browser inventory exposed no browser surfaces.

The PostgreSQL 17 runner constructs the pinned MAIN 21-migration baseline, populates synthetic representative standard purchases/payments, expired/paused packages, named/unnamed guests, multi-seat/attended/canceled bookings, credit/debit/refund ledger history and accounting/payroll values. It then applies exactly the three approved migrations. All 11 original-table fingerprints and existing constraints/indexes are preserved; snapshot values and neutral historical attribution are checked. It exercises the old MAIN column/write contract after migration and rolls the probe back. A genuine pre-migration pg_dump is restored into a separate isolated database and original fingerprints match. Verified disposable containers are removed.

This rehearsal is **not a backup or certification of the live production database**. It does not establish production identity, current migration history, schema drift or restore readiness.

An initial full run had 573 passing and one failing payroll-route mock that lacked the new unlimited-day dependency. The mock was adapted, a denial regression verifies payroll is not changed when rescheduling is blocked, and all final tests pass. Separate signed PostgreSQL/webhook tests cover actual refund/chargeback after ADMIN revocation and repeat callbacks. Independent scope review found no remaining critical issue.

Reproduce locally with `npm run test:monthly:production` and `npm run test:monthly:production -- --full`. The runner accepts only its own labeled localhost disposable database, never DEV/UAT/production.

## Remaining production gates and deployment sequence

1. Obtain explicit permission to privately use Production DATABASE_URL solely for verification and protected backup/recovery testing; never print it. The current authentication instruction prohibits production-secret access.
2. Cross-check the exact Vercel Production mapping with authenticated Neon project/branch/endpoint/database/schema identity. Never substitute local DEV/UAT or merely valid credentials.
3. Audit live Prisma checksums/history, drift, constraints and existing data. Only the three approved migrations may be pending; any unexpected/failed migration stops release.
4. Create a protected, recoverable production backup/restore point outside Git. Verify archive integrity and actual isolated restore with relevant schema/data fingerprints. Restrict/encrypt the archive appropriately and keep customer data out of logs.
5. Reconfirm MAIN, live identity, backup, backward compatibility and exclusive schema-deployment state. Produce the final safety audit. Respect the user's separate no-deployment restriction until lifted.
6. Apply the approved migrations using the guarded repository migration workflow with the verified connection. On failure, stop: do not deploy or improvise SQL repairs.
7. Verify all three migration results, unchanged original data and operational old application. Re-fetch MAIN; if unchanged, integrate only the reviewed candidate by safe fast-forward and push main without force.
8. Verify the new Vercel production SHA, ready state, live aliases and non-destructive health/auth/catalog/API checks. No real charges, test grants/revocations on customers, provider synchronization or flag changes.

## Recovery

Application rollback reference is original MAIN `a9b85f3c2c3f7114bd5a7fe9867e86b90a39b0b7` and original production deployment `dpl_4gpnF4dvbAftT2dybjXzuC1XqtaT`. Old MAIN compatibility with the additive schema is rehearsed locally. Cloud rollback/alias permissions and the current live recovery point are not yet tested; verify those before release.

Prefer application rollback or a forward fix while leaving additive schema in place. Do not automatically run reverse SQL, restore or reset production after customer writes. Any database recovery needs an independently verified production recovery point, operator authorization, reconciliation of legitimate later writes and an isolated restore test.

## Remaining manual QA

On an isolated preview, a real administrator should check desktop/mobile monthly forms, Spanish validation, manual assignment confirmation, paid-revocation warning/reason/dialog, normal package controls, monthly history and revoked availability. Real-money purchase verification requires separate administrator acceptance; no live charge is part of automated testing.

## Exact candidate files

- `docs/monthly-unlimited-production-lineage.md`
- `docs/monthly-unlimited-production-release.md`
- `package.json`
- `prisma/migrations/20261011000001_add_monthly_unlimited_production/migration.sql`
- `prisma/migrations/20261011010000_guard_unlimited_purchase_history/migration.sql`
- `prisma/migrations/20261011020000_snapshot_existing_purchase_labels/migration.sql`
- `prisma/schema.prisma`
- `scripts/check-monthly-migration-lineage.mjs`
- `scripts/check-monthly-migration-lineage.test.ts`
- `scripts/test-monthly-production.mjs`
- `src/app/(app)/admin/page.tsx`
- `src/app/(app)/mis-clases/page.tsx`
- `src/app/(marketing)/clases/[id]/page.tsx`
- `src/app/(marketing)/clases/page.tsx`
- `src/app/(marketing)/precios/page.tsx`
- `src/app/api/admin/booking/route.ts`
- `src/app/api/admin/bookings/[id]/route.test.ts`
- `src/app/api/admin/bookings/[id]/route.ts`
- `src/app/api/admin/classes/[id]/add-guest/route.test.ts`
- `src/app/api/admin/classes/[id]/add-guest/route.ts`
- `src/app/api/admin/classes/[id]/add-user/route.ts`
- `src/app/api/admin/classes/[id]/route.payroll.test.ts`
- `src/app/api/admin/classes/[id]/route.ts`
- `src/app/api/admin/classes/[id]/waitlist/[entryId]/promote/route.ts`
- `src/app/api/admin/manual-purchases/route.ts`
- `src/app/api/admin/packs/[id]/route.ts`
- `src/app/api/admin/packs/route.ts`
- `src/app/api/admin/purchased-packages/route.ts`
- `src/app/api/admin/users/[id]/details/route.ts`
- `src/app/api/admin/users/[id]/packs/[purchaseId]/pause/route.ts`
- `src/app/api/admin/users/[id]/packs/[purchaseId]/revoke/route.ts`
- `src/app/api/admin/users/[id]/packs/route.ts`
- `src/app/api/bookings/[id]/cancel/route.test.ts`
- `src/app/api/bookings/[id]/cancel/route.ts`
- `src/app/api/bookings/route.ts`
- `src/app/api/checkout-links/route.ts`
- `src/app/api/classes/[id]/waitlist/route.ts`
- `src/app/api/packs/route.test.ts`
- `src/app/api/packs/route.ts`
- `src/app/api/users/me/bookings/route.ts`
- `src/app/api/users/me/packs/route.ts`
- `src/app/api/users/me/unlimited/route.ts`
- `src/app/api/webhooks/mercadopago/route.ts`
- `src/components/packages/PackageTypeFields.tsx`
- `src/lib/admin-package-assignment.ts`
- `src/lib/admin-unlimited-revocation.ts`
- `src/lib/class-booking.test.ts`
- `src/lib/class-booking.ts`
- `src/lib/monthly-payment-reversal.test.ts`
- `src/lib/monthly-unlimited.database.test.ts`
- `src/lib/monthly-unlimited.test.ts`
- `src/lib/monthly-unlimited.ts`
- `src/lib/package-checkout.ts`
- `src/lib/package-config.ts`
- `src/lib/unlimited-calendar.ts`
- `src/lib/waitlist-promotion.test.ts`
- `src/lib/waitlist-promotion.ts`
