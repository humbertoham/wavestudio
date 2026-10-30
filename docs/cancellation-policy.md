# UAT cancellation policy

The cancellation window is six hours (360 minutes) before the scheduled class
start. `src/lib/cancellation-policy.ts` owns the window, timestamp comparison,
Spanish policy text, and late-cancellation warning. The self-service API makes
the authoritative decision using one server timestamp, which is also saved as
`canceledAt`. Browser warnings use the same comparison; client-supplied refund,
late-cancellation, or time fields do not control the API decision.

| Time before class | Classification |
| --- | --- |
| 12 or 7 hours | On time |
| Exactly 6 hours | On time |
| 6 hours minus 1 millisecond | Late |
| 5 hours 59 minutes, 4 hours, or 2 hours | Late |
| At or after class start | Self-service cancellation remains blocked |

Comparisons use exact timestamps, without rounded display hours. Existing
timezone formatting, including `America/Monterrey`, remains unchanged.

## Existing business behavior

- On-time self-service cancellations restore the original `BOOKING_DEBIT`
  amounts to their original packages and record `CANCEL_REFUND` entries.
- Late self-service cancellations remain allowed without restoring credits.
- Bookings without debits receive no artificial credits. Existing refund-ledger
  checks and duplicate-request responses remain in place.
- Both on-time and late cancellations release the booking's quantity of seats.
  Waitlist promotion continues through the existing credit and capacity checks.
- ADMIN/COACH cancellation retains its existing time-independent refund
  override, permissions, and duplicate-request behavior. Guest and manual
  bookings retain their existing rules.
- Wellhub/TotalPass use UAT's existing WAVE credit path. Their existing conditional
  $100 MXN warning and customer-contact language remain unchanged. No provider
  API events, external contracts, payment calls, or automatic charges are added.
- Monthly Unlimited and daily unlimited entitlements are absent from this UAT
  implementation; no code is imported from DEV to add them.

## Historical records

The booking-history display reads the existing `refundToken` decision saved by
self-service cancellation. This preserves previous on-time cancellations and
shows new late cancellations between six and four hours correctly. Records
without a saved decision retain their legacy four-hour display calculation,
including the existing manager-cancellation display behavior. That compatibility
fallback is not used to decide new self-service refunds.

No history, financial records, timestamps, schema, migrations, or environment
variables are changed. The new decision rule applies when this code is deployed
to UAT; MAIN and DEV are not updated or promoted.

## Verification

`cancellation-policy.test.ts`, `class-cancellation.test.ts`, and cancellation API
tests cover precise boundaries, Monterrey offsets, copy, historical decisions,
credit refunds, duplicates, permissions, and waitlist seat restoration. Run them
alongside the existing booking, purchase, provider, and Mercado Pago regressions
with `npm test`. These tests use mocks and fake clocks. Optional live-database
integration suites must remain disabled unless a separate safe database is
explicitly verified.
