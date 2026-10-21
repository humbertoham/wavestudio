# Monthly Unlimited production migration lineage

This release keeps the 21 migrations already present on production/main at
`a9b85f3` and adds exactly this sequence:

1. `20261011000001_add_monthly_unlimited_production`
2. `20261011010000_guard_unlimited_purchase_history`
3. `20261011020000_snapshot_existing_purchase_labels`

The first migration is a production-specific replacement for DEV's
`20261011000000_add_monthly_unlimited_packages`. DEV's original assumes that
the excluded Wellhub Booking migration already created `Booking.source`.
The replacement creates the monthly structures without that dependency.
It performs no `UPDATE` of historical bookings and makes no inference from
`Booking.userId`, affiliation, or provider data. Existing bookings receive the
neutral `CREDITS` column default. The application explicitly marks newly created
guest bookings as `ADMIN_GUEST`. The `WELLHUB` enum value is a reserved label;
it does not install or enable Wellhub Access, Booking, or synchronization.

The purchase-history guard and label-snapshot migrations remain unchanged from
the reviewed DEV feature. The final snapshot migration records existing package
names and historical payment amounts where available; it does not reclassify
bookings. Existing production migrations, including accounting/payroll, remain
unchanged.

## Source guard

Run from the release checkout before building or deploying:

```powershell
node scripts/check-monthly-migration-lineage.mjs
```

An unpacked candidate artifact can be checked explicitly:

```powershell
node scripts/check-monthly-migration-lineage.mjs --migrations-dir C:/reviewed-artifact/prisma/migrations
```

The guard reads local source files only. It loads no environment files or
credentials, opens no database connection, executes no SQL, and changes no files.
It fails for DEV's original monthly base, unexpected or missing migrations,
modified SQL, invalid migration directory contents, and a changed provider lock.
The manifest pins all 21 production baseline migrations and all three approved
monthly migrations with SHA-256 hashes. Hashing normalizes checkout-only CRLF
to LF; it does not ignore comments, whitespace, or SQL changes. These are source
integrity hashes, not a replacement for Prisma's database migration checksums.

A passing guard establishes the reviewed source lineage. It cannot establish
the applied history or schema of a target database. Deployment still requires
the separately authorized target-history check, reviewed migration rehearsal,
and normal Prisma migration status/checksum checks. Run the guard as a required
build/release check so a future merge cannot silently introduce both bases.

## Subsequent releases and DEV reconciliation

Deploy this same reviewed production lineage consistently to databases that
follow production/main. Keep the original DEV monthly base out of every later
surgical promotion. Do not copy the three monthly migrations from DEV wholesale
or merge DEV migration directories into production. Never replay the monthly
DDL under another migration name.

An existing DEV database that applied the original base has a different migration
history. Do not point this production candidate at it and assume that equivalent
tables make its history compatible. Do not mark the production base falsely
applied with `prisma migrate resolve`, edit `_prisma_migrations`, or modify an
already-applied migration to hide the divergence. Keep that DEV lineage separate
until its reconciliation is explicitly designed and rehearsed. A disposable new
database can follow production lineage from the beginning; an existing DEV
database requires an approved plan based on its real applied history and data.

Before any future broad DEV/main integration, deliberately construct one unified
migration lineage, review both branches' applied histories, and rehearse the full
upgrade against representative disposable copies of each affected lineage.
Review the resulting schema and data invariants as well as Prisma's migration
history. Only then update this guard's approved manifest in that same reviewed
change. A broad merge is not safe merely because source conflicts are resolved.

If Wellhub Booking is separately authorized later, that release must add the
missing shared Wellhub structures through a separately reviewed migration for
the actual production schema. Preserve the already-applied monthly structures,
avoid replaying monthly DDL, preserve the existing production webhook behavior
until its replacement is authorized, and rehearse the combined upgrade. The
guard deliberately rejects new Wellhub migrations until that lineage and its
manifest update have been reviewed together.

Future broad integration cannot be guaranteed by this source guard alone. The
manageable path is explicit lineage ownership, a required guard on production
candidates, surgical feature promotion until reconciliation, and a full database
rehearsal before changing the approved sequence.
