# Admin monthly unlimited revocation — DEV

Implemented October 19, 2026, from `ebff7088df53ae992343d28ab57eb21fab695b2e`, exclusively in the existing clean `dev` worktree (`wavestudio-wellhub-readiness`). The original workspace remains on `main` and was not modified.

## Architecture and decision

Each monthly entitlement is a `PackPurchase` owned by `userId`, with immutable type/name/price/month/year snapshots and its calendar expiry. Manual ADMIN grants have no payment; purchased entitlements retain their original `Payment`. `classesLeft` is zero for unlimited packages. `UnlimitedUsage` links the exact purchase and booking, retaining released and spent claims. The partial unique index on user/service date enforces one consumed daily allowance across all of a user's purchases.

`getUnlimitedEligibility` already excludes `revokedAt` purchases, selects another valid matching-month grant when available, and checks consumed dates globally. `createBookingWithCreditCheck` is the final booking service for direct bookings, class-manager bookings and both waitlist promotion paths. It retains normal-credit fallback.

The existing payment-reversal helper intentionally cancels future reservations and may block accounts. Admin revocation therefore uses a separate service and never invokes that helper, a provider API, a credit refund or a cancellation workflow. Payment webhook logic was not edited.

No migration is needed. Existing `PackPurchase.revokedAt` and `revocationReason` record current revocation state. The existing audit mechanism (`TokenLedger`, `ADMIN_ADJUST`, **delta 0**) records the recipient, exact purchase, acting admin, trimmed reason and timestamp. This audit does not create or remove spendable credits. Its deterministic unique key and purchase row lock prevent duplicate audit entries. No API in this change accepts client-supplied audit fields or edits an existing audit. Later provider updates to the purchase reason cannot overwrite the separate original admin audit.

## Changed files

| File | Behavior |
| --- | --- |
| `src/lib/admin-unlimited-revocation.ts` | Transactional ADMIN-only revocation; persisted role, ownership, type, expiry and reason validation; row lock; idempotent replay; zero-credit audit. |
| `src/app/api/admin/users/[id]/packs/[purchaseId]/revoke/route.ts` | New POST handler with 401/403 distinction, strict input validation, Spanish messages and stable error codes. |
| `src/app/api/admin/users/[id]/details/route.ts` | Adds month-specific revocability, manual/purchase origin, paid warning flag and original revocation audit to each entitlement. |
| `src/app/(app)/admin/page.tsx` | Users → Packages shows name, month/year, status, origin and grant/purchase date. Active/upcoming monthly entitlements offer “Revocar ilimitado”; standard packages keep their existing pause controls. Native modal provides recipient/package confirmation, required reason, paid-package warning, Cancelar, Confirmar revocación, processing lock and success/error feedback. Revoked rows show admin, timestamp and reason. |
| `src/lib/class-booking.ts` | Locks and rechecks the selected unlimited purchase before creating the booking/usage; holds the lock through commit. |
| `src/lib/monthly-unlimited.ts` | Recognizes PostgreSQL serialization/deadlock errors from raw row-lock queries so existing callers retry the whole transaction with a fresh snapshot. |
| `src/lib/unlimited-calendar.ts` | Explicit Spanish error when revoked access cannot fund a reservation. |
| `src/app/(app)/mis-clases/page.tsx` | Revoked packages remain in history with “Revocado,” muted styling and an explicit unavailable-for-new-bookings message. Existing summary API already returns `available: false`. |
| `src/lib/monthly-unlimited.database.test.ts` | 21 additional real PostgreSQL/API regression cases, including both concurrency orderings, duplicate revocation, both waitlist paths and preserved financial/booking history. |
| `docs/admin-unlimited-revocation-dev-report.md` | This report. |

## Concurrency and existing reservations

Admin revocation and final unlimited booking authorization lock the **same exact PackPurchase row**. A booking that owns the lock completes before revocation and remains a valid historical reservation. A booking with a stale SERIALIZABLE snapshot fails its locking read after a committed revocation; the caller retries the entire transaction. READ COMMITTED callers also inspect the current locked row and cannot commit a revoked claim. Automatic waitlist promotion propagates transaction conflicts instead of swallowing them.

Revocation only changes the selected purchase's revocation fields and appends its audit. It does not alter bookings, occupancy, attendance, usage, normal credits, other months, or other purchases. Existing reservations remain ACTIVE. Subsequent early/late cancellations keep the existing rules and do not clear revocation. Remaining same-month grants cannot restore an already-consumed daily claim because usage is checked per user/date, not per purchase.

## Database verification

Read-only preflight loaded the explicit DEV URL from the original workspace's ignored `.env.dev.local` and asserted both the configured hostname and server-reported identity: Neon project `icy-smoke-06115035`, branch `br-patient-star-apmp0do1`, endpoint `ep-round-scene-ap67u1ov`, database `neondb`.

All **25 migrations** are applied, historical checksums match, and there are **zero pending migrations**. Prisma migrate status reports up to date. The existing restore-verified October 14 DEV backup remains present with its verified checksum. No migration, reset, db push, schema alteration or production/UAT database access was performed.

An HTTP smoke test ran the production build on localhost with the verified Neon DEV datasource, an ephemeral signing secret and disabled external integrations. Only explicitly tracked disposable DEV accounts, package, classes and instructor were created. The test exercised real session middleware, manual assignment (200), USER/COACH denial (403), anonymous denial (401), empty reason rejection (400), concurrent revocation/replay (both 200, one state change), denied new booking (402, `UNLIMITED_ENTITLEMENT_REVOKED`), admin audit/history and unavailable user summary. It confirmed existing booking/usage remained unchanged, no payment or nonzero credit entries were created, and cancellation preserved revocation. Existing-data counts/fingerprints across the affected tables matched the baseline. Fixtures were removed and their absence verified.

## Validation

| Check | Result |
| --- | --- |
| Prisma generate / validate | PASS |
| TypeScript `tsc --noEmit` | PASS |
| Full suite | **579 passed, 0 failed, 0 skipped; 76 files** |
| Focused monthly suite | **124 passed, 0 failed, 0 skipped; 2 files** |
| Fresh disposable PostgreSQL | All 25 migrations applied successfully; no remote test datasource permitted by the test runner. |
| Production-style build with isolated fixture credentials | PASS; existing baseline-browser-mapping age warning only. |
| DEV HTTP/database smoke | PASS; disposable fixtures removed. |
| Diff whitespace / secret scan | PASS; no configured-secret or credential-pattern findings in delivery files. |
| Browser visual QA | Not performed: browser inventory exposed no available browser surfaces. |

The initial focused run had 118 passing and four failures: two fixtures attempted to modify protected immutable purchase snapshots, one expected the wrong existing waitlist HTTP status, and one exposed the raw-query serialization retry gap. The fixtures/status expectations and actual retry handling were corrected. The subsequent 122-test focused suite passed; two additional concurrency/waitlist cases bring the final focused subset to 124. All failures were resolved before delivery.

Reproduce using `npm run test:monthly:dev` and `npm run test:monthly:dev -- --full` on `dev` with Docker running. Existing Mercado Pago purchase/refund/chargeback, manual assignment, standard-credit, Wellhub and TotalPass regression coverage remains in the complete suite. No real provider payments or refunds were issued.

## Delivery and safety

Only `dev` is committed and pushed, without force-push or merges. The delivery response records the final commit SHA and exact-commit Vercel deployment result. No Vercel environment variables were changed. Verification of a successful commit deployment is distinct from authenticated verification of a custom DEV-domain alias.

The existing local Vercel credential returned HTTP 403 for authenticated API access; custom-domain alias verification is unavailable through that credential. Public GitHub commit statuses remain available for exact-commit deployment verification.

`main` remains `a9b85f3c2c3f7114bd5a7fe9867e86b90a39b0b7`; `uat` remains `af161a20b4c6fecd3c67a4a06e1b27f7a3ef433b`. UAT and production databases/deployments are untouched. Standard packages, Wellhub and TotalPass behavior is unchanged.
