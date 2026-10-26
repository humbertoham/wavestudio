# Isolated Wellhub production candidate ? October 26, 2026

## Status and identity

Local review candidate only. No push, deployment, environment edit, live database access, provider synchronization, payment, check-in or real booking operation was performed. No production credentials were loaded for this task.

- Branch: `release/wellhub-production-isolated`
- MAIN baseline/current protected MAIN: `15915ddb4fc9453b671ba7772a2924acbfa91503`
- DEV source (unchanged): `c0ee7213cc5cf7e24986660f6ae7122f97101fe6`
- UAT (unchanged): `af161a20b4c6fecd3c67a4a06e1b27f7a3ef433b`
- Candidate SHA: the local commit containing this audit; obtain with `git rev-parse HEAD`.
- Scope: current MAIN plus selective Wellhub code. No DEV merge/cherry-pick was performed.
- Source fixes included: c3f2a37, cb69f70, 5674ed5, 64d1e7b, dee2baf, 1203446, 7d08c66 and e1fccbc. The provider booking attribution line already adapted on DEV in c9709fa is retained without importing that commit's monthly migration.

## Validation

- Focused: 309 passed, 0 failed, 0 skipped (19 files).
- Full MAIN + Wellhub: 714 passed, 0 failed, 0 skipped (90 files); process exit 0.
- Real PostgreSQL/signed webhook/mock-provider E2E: 20 passed. The mock rejects Production hostnames and never falls through to real HTTP.
- Prisma generate/validate, TypeScript, guarded Production build: passed with synthetic fixture credentials, flags false.
- Scope/dependency guard, migration lineage and candidate credential-pattern scan: passed. Exact sanitized evidence is in [validation JSON](wellhub-production-validation.json).
- Earlier validation exposed and resolved fixture issues plus an unhandled provider-rejection window; final successful process exit is required, not merely passing assertion counts.
- Desktop/mobile visual acceptance and actual Wellhub Production delivery were not performed.

Reproduce in this branch with Docker available: `npm ci --ignore-scripts`, then `node scripts/test-wellhub-production.mjs --full --build`. This uses only its own synthetic PostgreSQL container. The source guard and lineage guard are run before rehearsal. Do not substitute a database URL, run a live seed or reuse real credentials.

## Business logic protection

MAIN implementations of monthly grants/revocations/UnlimitedUsage, regular debit/refund transactions, checkout, Mercado Pago webhook/refund/chargeback handling, payroll/accounting, authentication, ADMIN/COACH helpers, TotalPass and FIFO waitlist promotion remain source-identical. The original 24 migration SQL files and lock remain unchanged. Cron configuration, /admin, /clases and /mis-clases pages remain unchanged; only class-detail source labels are added.

Shared routes retain MAIN transactions and policies. Gated provider hooks run after MAIN commits. Provider bookings use source WELLHUB, entitlementType WELLHUB and no packPurchaseId; they do not consume a WAVE credit or UnlimitedUsage. A partner cancellation can legitimately promote a WAVE waitlist reservation; that separate reservation uses MAIN eligibility/debit logic, tested for both credits and monthly unlimited.

Both disabled causes webhook HTTP 200 DISABLED before body parsing/storage/network. Sync/notification wrappers skip before DB/provider access, and explicit reconciliation refuses disabled operation. Existing MAIN data has no provider mappings; nullable fields do not change its booking semantics. A previously mapped class is conservatively archived on deletion even after flags are disabled, preserving provider linkage for later reconciliation.

## Production migration lineage and recovery

New migrations, following the 24 MAIN entries:

1. `20261026000000_add_wellhub_checkin_production`
2. `20261026010000_add_wellhub_booking_production`

They create only missing provider types/tables/indexes/FKs and additive nullable fields. Booking.source defaults WAVE for all existing rows; no inference from affiliation, userId, guest names or old credits is performed. Existing entitlementType values (including monthly/mixed/guest) and UnlimitedUsage remain unchanged. Original DEV Wellhub migrations and DEV's original monthly base are excluded.

Rehearsal applies the pinned MAIN 24 migrations, inserts synthetic standard/monthly purchases, money/debit/refund history, active/canceled/multi-seat/guest bookings, payroll/accounting and waitlist data, then applies the two new migrations. All existing column fingerprints across 13 tables, original constraints/indexes and Prisma history/checksums are preserved. Required provider uniqueness/capacity indexes are verified. A genuine pre-upgrade pg_dump is restored into a second isolated database and fingerprints match. Old MAIN SQL writes are exercised and rolled back. The final rehearsal also generates a separate old MAIN Prisma client and probes original read/create/cancel projections before and after upgrade.

This is rehearsal evidence, not a backup or inspection of live Production. Future release must separately establish actual target identity, applied Prisma history/checksums/drift and a recoverable live backup. Prefer code rollback with the additive schema retained; do not drop provider tables or restore Production after real writes without explicit recovery authorization and reconciliation.

### Future DEV reconciliation

Keep the divergent current DEV lineage intact until a separate synchronization task. Do not combine original DEV Wellhub/monthly DDL with these forward replacements, edit applied checksums or falsely mark migrations applied. Recommended convergence: provision a fresh isolated DEV database on the reviewed unified MAIN+Wellhub lineage; migrate only approved/sanitized DEV data through a rehearsed export/import with referential, booking, entitlement and payment invariants; keep the original DEV database/branch unchanged as recovery reference. Validate remaining DEV feature deltas on that unified source, then request explicit approval to switch DEV. Any in-place alternative needs a separately designed history/schema reconciliation and rehearsal against both real histories.

## Required Production configuration ? unresolved value gate

The prior audit confirmed all eight keys target Production, but all values are Sensitive/write-only. No Vercel value retrieval/replacement was attempted in this candidate task. Stored values, including both flags and matches to local secrets, remain UNVERIFIABLE.

| Key | Required value / verification |
| --- | --- |
| WELLHUB_GYM_ID | 534829 |
| WELLHUB_BOOKING_PRODUCT_ID | 741786 (Clases) |
| WELLHUB_API_BASE_URL | https://api.partners.gympass.com/access/v1 |
| WELLHUB_BOOKING_API_BASE_URL | https://api.partners.gympass.com/booking/v1 |
| WELLHUB_CHECKIN_ENABLED | false, explicitly confirmed for release |
| WELLHUB_BOOKING_ENABLED | false, explicitly confirmed for release |
| WELLHUB_API_TOKEN | approved Production credential; local credential previously passed HTTP 200; saved Vercel match unverified |
| WELLHUB_WEBHOOK_SECRET | approved Production signing secret and callback registration; saved Vercel value unverified |

The callback remains https://www.wavestudio.mx/api/integrations/wellhub/webhook. No category ID is needed. Optional timeout remains 800 ms (maximum 900); synchronization horizon defaults 30 days. The Sandbox checks reject Production by design and must not be used to activate it.

## Exact file-by-file impact (62 files)

| File | Area | Necessity and MAIN protection |
| --- | --- | --- |
| `.env.example` | Configuration | Documents optional server settings; both flags false and credentials empty. Does not load or change an actual environment. |
| `docs/integrations/wellhub-booking.md` | Documentation | Integration contract and operator guidance; points to the forward Production lineage rather than replaying original DEV SQL. |
| `docs/integrations/wellhub-checkin.md` | Documentation | Integration contract and operator guidance; points to the forward Production lineage rather than replaying original DEV SQL. |
| `docs/integrations/wellhub-production-candidate.md` | Audit | This complete impact assessment, production gates, reconciliation plan and validation/known-risk record. |
| `docs/integrations/wellhub-production-validation.json` | Evidence | Sanitized synthetic-only test counts and migration preservation/recovery evidence; no production data or credentials. |
| `package-lock.json` | Tooling | Adds only tsx and its esbuild packages. All 286 pre-existing dependency entries remain byte-equivalent as parsed JSON. |
| `package.json` | Tooling | Adds explicit opt-in Wellhub checks/sync/rehearsal commands and pinned DEV-tested tsx. Every existing script and runtime dependency stays unchanged. |
| `prisma/migrations/20261026000000_add_wellhub_checkin_production/migration.sql` | Schema migration | Forward-only check-in enum/table/index/FK creation after the 24 MAIN migrations; no backfill/update/delete of existing data. |
| `prisma/migrations/20261026010000_add_wellhub_booking_production/migration.sql` | Schema migration | Forward-only Booking.source default WAVE, nullable provider fields, class mappings and event table/index/FKs. Existing entitlementType, monthly usage, money and history stay unchanged. |
| `prisma/schema.prisma` | Schema | Adds provider source/mapping/event/check-in types and relations only. Preserves every MAIN payroll, accounting, monthly, credit and payment field/model. |
| `scripts/check-monthly-migration-lineage.mjs` | Schema guard | Extends the existing approved manifest by two hashed forward migrations; keeps all 24 historical SQL hashes and existing build/migration guard commands. |
| `scripts/check-monthly-migration-lineage.test.ts` | Tests | Keeps all baseline rejection checks; verifies the two new hashes and rejects original DEV Wellhub migrations. |
| `scripts/check-wellhub-booking-sandbox.mjs` | Sandbox preflight | Explicit no-network Sandbox-only check; never invoked as a Production readiness check or automatically. |
| `scripts/check-wellhub-booking-sandbox.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `scripts/check-wellhub-production-scope.mjs` | Source protection | Read-only allowlist/dependency integrity guard against unrelated MAIN changes, including exact existing monthly-test adaptation. |
| `scripts/check-wellhub-sandbox.mjs` | Sandbox preflight | Explicit no-network Sandbox-only check; never invoked as a Production readiness check or automatically. |
| `scripts/check-wellhub-sandbox.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `scripts/check-wellhub-secrets.mjs` | Secret scan | Scans candidate additions for credential/private-key/JWT/nonlocal DB patterns without reading production env files or printing matching values. |
| `scripts/sync-wellhub-booking.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `scripts/sync-wellhub-booking.ts` | Explicit operator tooling | Opt-in CLI only; rejects disabled Booking before DB reads. No invocation from builds/startup/cron. Live use requires separate release authorization. |
| `scripts/test-wellhub-production.mjs` | Isolated validation | Creates only a uniquely labeled loopback Docker PostgreSQL 17 database, scrubs inherited service credentials, applies pinned MAIN then forward Wellhub SQL, fingerprints existing data/catalog/history, restores backup, tests old MAIN runtime/SQL, runs checks/tests/build and removes its own container. |
| `src/app/(marketing)/clases/[id]/page.tsx` | Class UI | Adds provider source labels; keeps monthly badges and MAIN class management. External attendees are not mislabeled as ordinary guests; provider cancellations do not display WAVE corporate penalties. |
| `src/app/api/admin/booking/route.ts` | Booking creation | Adds post-commit gated occupancy sync and provider-reference redaction. Keeps MAIN admin authentication, shared booking transaction, credit/unlimited consumption and errors. |
| `src/app/api/admin/bookings/[id]/route.ts` | Booking cancellation | Adds safe provider notification/sync after MAIN cancellation commits. Existing role checks, refunds, unlimited releases and retry logic remain intact. |
| `src/app/api/admin/bookings/route.ts` | Shared API | Redacts provider identifiers including nested class includes; existing query/auth and business response fields remain. |
| `src/app/api/admin/classes/[id]/add-guest/route.ts` | Guest booking | Adds gated post-commit occupancy sync; keeps MAIN guest attribution, quantity, role and capacity checks. |
| `src/app/api/admin/classes/[id]/add-user/route.ts` | Admin booking | Adds gated post-commit occupancy sync; retains MAIN shared credit/unlimited transaction and role guards. |
| `src/app/api/admin/classes/[id]/cancel/route.ts` | Class cancellation | Adds gated sync and composes provider redaction with MAIN payroll redaction; no change to authorization or cancellation transaction. |
| `src/app/api/admin/classes/[id]/route.ts` | Class capacity/payroll | Adds sync only after the existing transaction commits; preserves payroll assignment/audit, monthly service-day guard, role checks and capacity errors. Both redaction layers are composed. |
| `src/app/api/admin/classes/[id]/waitlist/[entryId]/promote/route.ts` | Waitlist | Adds post-commit occupancy sync after MAIN promotion; keeps MAIN entitlement/credit rules, role checks and concurrency handling. |
| `src/app/api/admin/classes/route.ts` | Class creation/payroll | Preserves MAIN payroll snapshot, challenge transaction and createMany recurrence behavior. When Booking is explicitly enabled, local occurrence IDs allow post-commit sync of each newly created recurrence. Disabled IDs/creation path remain MAIN behavior. |
| `src/app/api/bookings/[id]/cancel/route.ts` | User cancellation | Adds safe partner cancellation notification and class sync after MAIN commit (including already-canceled reconciliation); retains MAIN cancellation window, credit refund, unlimited release and FIFO waitlist logic. |
| `src/app/api/bookings/route.ts` | User booking | Adds gated post-commit class sync only. MAIN credit/unlimited, capacity, auth and transaction-conflict logic is retained. |
| `src/app/api/classes/[id]/route.ts` | Shared class API | Adds provider identifier redaction at class and attendee levels on top of existing payroll redaction. MAIN ADMIN/COACH access remains unchanged. |
| `src/app/api/classes/route.ts` | Class creation | Adds gated post-commit sync and provider redaction. Preserves MAIN payroll snapshot, challenge transaction and ADMIN guard. |
| `src/app/api/integrations/wellhub/webhook/route.integration.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/app/api/integrations/wellhub/webhook/route.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/app/api/integrations/wellhub/webhook/route.ts` | Webhook | Replaces inert stub with bounded signed parser/router, independently gated check-in/booking processing, safe logs and retry responses. Both disabled returns HTTP 200 DISABLED before parsing/storage/network; GET keeps HTTP 405/no-store. Public URL stays unchanged. |
| `src/lib/class-deletion-response.ts` | Class archival | Adds safe sync only after successful existing deletion/archive. No new cron or background job. |
| `src/lib/class-deletion.ts` | Class archival | Selects mapping IDs and archives a mapped class rather than losing its provider mapping. Existing MAIN unmapped class/history deletion semantics and authorization remain intact. |
| `src/lib/env.ts` | Configuration | Only extends optional server-side key names. No credential/environment loading or auth changes. |
| `src/lib/monthly-unlimited.database.test.ts` | Existing regression suite | Only adapts the old synchronous stub assertion to awaited HTTP 200 DISABLED. A source guard checks that no other MAIN monthly test code is changed. |
| `src/lib/wellhub-production.database.test.ts` | Real PostgreSQL E2E | 20 strict provider-mock scenarios cover signed sync/book/replay/cancel, final-seat concurrency, WAVE/TotalPass/monthly/MP/payroll invariants, waitlists, failures, disabled flags and ADMIN/COACH policies. |
| `src/lib/wellhub/booking/client.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/booking/client.ts` | Booking client | Official Booking v1 class/slot and v2 booking decisions, JSON/Bearer scheme, deadlines and classified errors. No category calls. |
| `src/lib/wellhub/booking/serialize.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/booking/serialize.ts` | Data redaction | Removes provider IDs/errors through nested DTOs while retaining MAIN fields and Date/Decimal values. Payroll redaction remains MAIN-owned and composed at call sites. |
| `src/lib/wellhub/booking/service.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/booking/service.ts` | External bookings | Serializable capacity and identity checks; source WELLHUB + entitlementType WELLHUB + null packPurchaseId, no debit/usage calls. Cancellations may promote legitimate WAVE waitlist reservations through unchanged MAIN helper. Adds retryable owned-event error recovery and removes async rejection-handler gap. |
| `src/lib/wellhub/booking/sync.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/booking/sync.ts` | Class/slot synchronization | Stable references, advisory lock, provider reconciliation and active quantity sums. Disabled exits before DB/network. Safe wrappers do not fail ordinary MAIN requests on provider errors. |
| `src/lib/wellhub/checkin.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/checkin.ts` | Check-in | Validates gym before any persistence/provider call; records validation outcomes/idempotency only. Never touches bookings, affiliations, payments, credits or monthly usage. |
| `src/lib/wellhub/client.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/client.ts` | Check-in client | Server-only Bearer validation client with strict configured host, deadline and classified errors; never invoked while check-in is disabled. |
| `src/lib/wellhub/config.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/config.ts` | Configuration | Includes e1fccbc production-host support; separates Production/Sandbox allowlists, validates IDs/timeouts and defaults both flags false. No obsolete category requirement. |
| `src/lib/wellhub/parser.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/parser.ts` | Security | Validates official payload shape/identifiers, creates stable check-in identity and requires explicit booking event identity; no raw webhook persistence. |
| `src/lib/wellhub/signature.test.ts` | Tests | Provider-mocked or isolated fixture tests for this Wellhub module/tool; no production calls. Existing MAIN tests remain in the full suite. |
| `src/lib/wellhub/signature.ts` | Security | Constant-time HMAC verification of exact raw bytes using X-Gympass-Signature; rejects invalid signatures before processing. |
| `src/lib/wellhub/store.ts` | Check-in persistence | Stores minimal idempotency/outcome records; conservative existing WELLHUB user matching only, no account creation. |

## Remaining risks and manual acceptance

- Vercel saved IDs/URLs/credentials and disabled flags need operator attestation from their secure source or separately authorized replacement; presence is not equality.
- Actual Production database identity/history/drift and recoverable backup remain unaudited in this task.
- Actual Wellhub delivery, signing secret, callback registration, one-second response timing, provider retries/redelivery timestamp stability and remote reconciliation require a later controlled pilot.
- HMAC authenticates payloads but is not a general freshness protocol. Booking event/booking-number uniqueness prevents duplicate creation; requests for started classes are rejected. Check-in expiry is decided by the provider and tested as a rejection. Do not impose an invented timestamp cutoff that could reject valid delayed cancellations.
- A process crash while an event is PROCESSING or during remote/local split commit may require operator reconciliation; automated tests cover controlled API/transaction failure/redelivery, not every infrastructure crash.
- Provider occupancy PATCHes can arrive out of order under network delay; local serializable WAVE occupancy remains authoritative and explicit sync repairs provider state. Verify this in the controlled pilot.
- Real desktop/mobile review of source badges, class management, /admin, /clases and /mis-clases remains pending. No real payment or customer mutation was used to certify this candidate.

## Next phase ? requires separate explicit authorization

1. Review this candidate/diff and obtain approval to publish a review branch/PR; do not push MAIN or merge DEV.
2. Establish the live migration history/target identity and recovery point through separately authorized read/backup checks. Rehearse any drift; stop on unexpected objects or migrations.
3. Obtain explicit confirmation of both Production flags false and the approved IDs/hosts/secrets. Any environment replacement requires separate permission.
4. Under a separately authorized release window, apply only the reviewed additive migrations through the guard; verify preservation and old-app compatibility, then deploy the reviewed candidate with BOTH flags false. Check the deployment SHA/alias/Ready state, disabled webhook/no outbound calls, existing business flows and logs. Do not run the sync CLI.
5. Stop again. Enabling either feature, provider synchronization or real pilot reservations requires a distinct controlled-pilot authorization and operator acceptance.
