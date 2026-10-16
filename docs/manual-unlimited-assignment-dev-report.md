# Manual Monthly Unlimited assignment — DEV validation

Validated on October 16, 2026, starting from `c9709fa885ee35bf41d932e9de3bfb149f3565e2`, exclusively on branch `dev` in its existing separate worktree.

**Diagnosis and reproduction**

The actual user administration screen is `/admin?tab=users`; this revision has no `/admin/usuarios` route. Its assignment action calls `POST /api/admin/users/[id]/packs`. The separate `POST /api/admin/manual-purchases` endpoint was also inspected and corrected for unlimited assignments.

An isolated first assignment at the starting commit succeeds with HTTP 200. The reported original HTTP 500 was therefore **not reproduced for a valid first assignment**, and no specific remote failed customer request or server log was available to attribute it conclusively. The verified defects were:

- The frontend awaited `fetch` without inspecting `res.ok` or its response body. It cleared the selection and refreshed even on failure. It also labeled an unlimited package as “0 clases” and promised token credits.
- `assertNoMonthlyDuplicate` rejects an existing entitlement or an unexpired pending checkout for the same month with HTTP 409 and `UNLIMITED_MONTH_ALREADY_PURCHASED`. An expired month returns HTTP 409 and `UNLIMITED_NOT_ACTIVE`. The old assignment endpoint supplied no actionable message, and the frontend hid these rejections. A simultaneous repeat of the same request also returned a conflict instead of replaying its result.
- A JSON `null` body caused `TypeError: Cannot destructure property 'packId' ... as it is null` before validation. This uncaught handler exception would produce a server error. It now returns HTTP 400.
- Both manual endpoints unconditionally created an APPROVED Payment at catalog price for unlimited assignments. This fabricated revenue. Neither endpoint recorded the acting admin for the grant.
- Standard assignment had no request idempotency and could grant credits twice on a repeat request.

This is a frontend response-handling and manual-grant/accounting defect, with an additional API payload-validation defect. Read-only inspection of verified Neon DEV confirmed all 25 migrations applied, all three monthly migrations present, the monthly constraints present, and both MERCADOPAGO and ADMIN payment providers. There was no evidence of a missing Prisma migration or enum.

The original 87 focused tests passed. With the new regression assertions against the old code, 90 passed and 9 failed. Those failures exposed the above contracts rather than establishing an unobserved remote HTTP 500 cause.

**Changed files and resulting behavior**

| File | Change |
| --- | --- |
| `src/lib/admin-package-assignment.ts` | Shared transactional admin grant, input/key validation, account lock, idempotent replay, existing monthly duplicate guard, Spanish failures, and zero-delta audit. Reuses `grantPackagePurchase`. |
| `src/app/api/admin/users/[id]/packs/route.ts` | Persisted ADMIN authorization; 401/403 distinction; validated payload; shared grant; explicit response and error message. |
| `src/app/api/admin/manual-purchases/route.ts` | Same unlimited grant semantics and audit. Preserves the separate legacy standard manual-sale behavior, including nullable notes. |
| `src/app/(app)/admin/page.tsx` | Name/type/month/year/daily allowance, explicit recipient confirmation, nearby success/error feedback, submit lock, disabled controls, stable request key for retries, and ADMIN/no-payment reporting label. |
| `src/app/api/admin/purchased-packages/route.ts` | Reports audited unpaid grants with amountPaid 0, no payment status/provider, ADMIN origin, actor ID, and assignment timestamp. Keeps catalog price snapshots separate. |
| `src/lib/monthly-unlimited.database.test.ts` | Sixteen additional PostgreSQL/API cases, and corrected the previous expectation that unlimited manual grants create payments. |
| `scripts/test-monthly-unlimited-dev.mjs` | Waits for Docker's localhost port binding before validating it, fixing an observed startup race. |
| `docs/manual-unlimited-assignment-dev-report.md` | This report supersedes the earlier feature report's description of manual unlimited assignments as paid sales. |

**Admin flow**

1. Open Admin → Usuarios (`/admin?tab=users`) and select the account.
2. Under “Asignar paquete,” select an existing Monthly Unlimited package. Its name, applicable month/year, unlimited type, and one-class-per-day rule are shown. No class quantity is requested.
3. Click “Asignar,” review the recipient/package, and click “Confirmar asignación.”
4. The server checks the persisted ADMIN role, validates terms and duplicates, and atomically creates the entitlement plus its audit. Success appears beside the assignment control; failures retain the selection and show an actionable Spanish message.
5. The existing `/mis-clases` packages API includes the entitlement without requiring a payment relation.

Concurrent identical keyed requests return the same purchase. Distinct requests for the same user's month are serialized and only one grants access. Standard assignment retains its existing classes, expiry, payment and credit behavior, with protection for repeats carrying the same request key.

**Database and accounting**

No schema change or migration was required. No migrations, reset, or db push were executed against Neon DEV. The existing 25 migrations were independently applied from scratch to disposable PostgreSQL 16 containers.

An unlimited admin grant has `paymentId = null`, `classesLeft = 0`, its configured month/year, and the existing immutable name/price/type/period snapshots. It creates no Payment, checkout, positive credit ledger entry, or revenue. The catalog price remains historical package information and is not treated as amount paid.

The existing TokenLedger audit mechanism is reused with `reason = ADMIN_ADJUST` and **delta = 0**. This is an audit entry, not a credit: it records the recipient relation, purchase relation, package ID/snapshot, actor admin ID, source ADMIN, action PACKAGE_ASSIGNMENT, request key and database timestamp. Existing positive ledger entries and balances are untouched. No new audit table is needed.

Legacy standard manual payments remain as before. Historical records are not rewritten, including any older manual unlimited payments; this fix does not attempt an unauthorized accounting reconciliation.

Booking, cancellation, capacity and concurrency services were not forked or changed. Tests cover advance reservations for the class's configured month, one daily unlimited claim, month mismatch, early release, late consumption, unlimited priority with real-credit fallback, global daily uniqueness across purchases, and racing for the final seat. Existing Mercado Pago checkout/signed webhook, Wellhub and TotalPass regression tests remain included.

**Validation**

| Check | Result |
| --- | --- |
| Focused suite | 103 passed, 0 failed, 0 skipped; 2 files |
| Final full suite | 558 passed, 0 failed, 0 skipped; 76 files |
| Prisma generate and validate | PASS |
| TypeScript `tsc --noEmit` | PASS |
| Production build with isolated fixture environment | PASS |
| Git diff whitespace check | PASS |
| Secret scan | No configured-secret or credential-pattern findings in changed/new delivery files |
| Neon DEV HTTP integration | PASS, disposable accounts/package only; fixtures removed and absence verified |
| Browser visual QA | Not completed: browser inventory was empty; Edge and in-app browser were unavailable. Temporary local UI database/server removed. |

The DEV HTTP smoke ran the production build on localhost connected explicitly to the verified Neon DEV URL, using a temporary local signing secret and disabled provider integrations. It exercised real session validation and HTTP handlers: assignment 200, same-key replay 200 with the same purchase ID, distinct duplicate 409, USER denial 403, and `/api/users/me/packs` 200. Database assertions confirmed zero payments, zero credit delta, and one actor audit. Both disposable users, the purchase, audit, and package were removed in cleanup. No existing customer account was mutated. This was not a browser test or a test of the deployed Vercel hostname.

One intermediate full run had 554 passing and one failure in the newly added capacity test: the assertion used Promise.all even though the expected losing reservation throws CLASS_FULL. It was corrected to inspect Promise.allSettled and assert that exact rejection. The application capacity behavior was correct; no booking implementation was changed. The existing baseline-browser-mapping age warning remains non-blocking.

Reproduce focused/full tests with `npm run test:monthly:dev` and `npm run test:monthly:dev -- --full` from `dev` with Docker available. The runner enforces an isolated localhost database and mocked payment/provider calls.

**Git, deployment and safety**

The delivery response records the final commit SHA, push result and exact-commit Vercel status. Deployment is triggered solely by pushing `dev`; no force push or production-variable edit is part of this change.

At start and pre-push verification, main/origin-main remained `a9b85f3c2c3f7114bd5a7fe9867e86b90a39b0b7` and uat/origin-uat remained `af161a20b4c6fecd3c67a4a06e1b27f7a3ef433b`. The original main worktree was left unchanged. UAT and production databases, deployments and Vercel variables were not modified. Provider credentials and private customer data are excluded from this report.
