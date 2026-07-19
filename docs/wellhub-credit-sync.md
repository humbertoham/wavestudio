# WellHub Credit Sync

## Root Cause

The WellHub plan migration added `User.wellhubPlan` as nullable without
backfilling existing `WELLHUB` users. Monthly renewal later required a non-null
WellHub plan, so existing WellHub users with `wellhubPlan = NULL` were skipped as
ineligible.

Admin updates also only changed `User.affiliation` and `User.wellhubPlan`; they
did not adjust `PackPurchase.classesLeft` or write token ledger history.

## Repair Identification

The repair utility identifies only these records:

- WellHub users missing a persisted plan:
  `User.affiliation = 'WELLHUB' AND User.wellhubPlan IS NULL`
- Legacy corporate ledger rows missing traceability metadata or a unique key:
  `TokenLedger.reason = 'CORPORATE_MONTHLY' AND (metadata IS NULL OR idempotencyKey IS NULL)`

The script does not grant credits, reset balances, or create users/packages.

## Commands

Dry-run dev:

```bash
npm run wellhub:repair -- --target=dev
```

Dry-run UAT:

```bash
npm run wellhub:repair -- --target=uat
```

Apply an explicit missing-plan backfill after confirming the correct plan:

```bash
npm run wellhub:repair -- --target=dev --apply --set-missing-wellhub-plan=PLATINUM
```

Backfill legacy ledger metadata/idempotency keys:

```bash
npm run wellhub:repair -- --target=dev --apply --backfill-ledger-metadata
```

The script only accepts `dev` or `uat`, loads `.env.<target>.local`, and refuses
database URLs that appear to reference production.
