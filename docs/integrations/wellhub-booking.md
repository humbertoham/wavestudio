# Wellhub Booking API integration (DEV only)

## Scope and architecture

This integration is deliberately limited to `dev` and the official Wellhub
sandbox. `getWellhubBookingConfig` refuses to enable Booking when `APP_ENV` or
`VERCEL_ENV` is `production`, and its URL allowlist accepts only
`https://apitesting.partners.gympass.com/booking/v1`.

```text
WAVE Class
  -> Wellhub class (reference = WAVE class ID)
  -> Wellhub slot (scheduled WAVE occurrence)
  -> booking-requested signed webhook
  -> serializable WAVE capacity transaction
  -> real WAVE Booking(source = WELLHUB)
  -> PATCH Wellhub Booking v2 RESERVED/REJECTED
  -> PATCH slot total_booked from authoritative active WAVE bookings
  -> booking-canceled / booking-late-canceled
  -> canceled WAVE Booking + normal WAVE waitlist promotion
  -> authoritative slot count update
```

Check-in and Booking share one public callback:

`POST /api/integrations/wellhub/webhook`

The router reads the exact raw body (maximum 64 KiB), verifies the official
`X-Gympass-Signature` HMAC-SHA1 signature in constant time, validates the JSON,
and routes by `event_type`. Check-in and Booking have independent feature flags.

Official references:

- [Booking API getting started](https://developers.wellhub.com/product/booking-api/1.0/getting-started)
- [Booking API endpoints](https://developers.wellhub.com/product/booking-api/1.0/endpoints)
- [Booking webhooks](https://developers.wellhub.com/product/booking-api/1.0/webhooks)
- [Booking FAQ](https://developers.wellhub.com/product/booking-api/1.0/faq)
- [Official Booking/Access Control Postman guide](https://documenter.getpostman.com/view/14766562/2sAYdbPtHN)

## Source of truth and capacity

WAVE owns the class schedule, duration, instructor, capacity, cancellation,
booking state, and availability. Wellhub is an external booking channel.

Authoritative occupancy is always recalculated from the database:

`SUM(Booking.quantity) WHERE classId = ? AND status = ACTIVE`

There is no independent Wellhub seat counter. User, admin, guest, promoted
waitlist, and Wellhub bookings occupy the same capacity. A serializable
PostgreSQL transaction reads the class and aggregate, creates the booking, and
retries serialization failures. The unique Wellhub booking number and unique
event constraints provide additional duplicate/concurrency protection.

## Class, category, and slot synchronization

WAVE currently has no normalized class-type/category model; each `Class` is a
scheduled occurrence with free-form `title` and `focus`. The Wellhub FAQ
explicitly permits a unique Wellhub class and slot per partner class, so each
WAVE occurrence maps to one Wellhub class and one slot:

- `Class.wellhubClassId` stores the Wellhub class ID.
- `Class.wellhubSlotId` stores the Wellhub slot ID.
- the Wellhub class `reference` is the stable WAVE class ID.
- the slot carries WAVE time, duration, capacity, active booking count, location,
  instructor, and active/canceled state.

Repeated sync updates the stored resources. If an external create succeeded but
the local mapping write failed, reconciliation lists classes by `reference` and
slots by exact occurrence time before creating anything, avoiding duplicates.

Wellhub categories are provider-owned taxonomy values exposed by `GET
/gyms/{gym_id}/categories`; the current official API does not provide a
category-create endpoint. Optional configured category IDs are validated
against that taxonomy and referenced on class create/update. WAVE does not
invent or create provider categories.

Class edits update the external class/slot. Cancellation or archived deletion
makes the Wellhub class non-bookable/invisible and the slot inactive. A class
with an external mapping is archived rather than hard-deleted so its mapping can
be disabled and its audit history retained. Capacity below active occupancy is
rejected locally and also refused by synchronization.

## Booking representation and credits

A Wellhub reservation is a real `Booking` with:

- `source = WELLHUB`
- `wellhubBookingNumber`
- `wellhubUserId`
- `wellhubSlotId`
- `wellhubState`
- optional conservative `userId`

If the signed request email exactly matches an existing WAVE user whose
affiliation is already `WELLHUB`, that user can be associated. Otherwise the
booking remains userless and uses the provided display name for class-management
views. No account is created, no credentials are fabricated, and an ordinary
WAVE account with the same email is not merged.

Wellhub bookings never call WAVE's credit-debit helper. They do not create or
modify `PackPurchase`, `classesLeft`, `TokenLedger`, Mercado Pago, TotalPass,
monthly Wellhub grants, or affiliation. Cancellation consequently performs no
credit refund.

## Webhook events and decisions

The exact current payload `event_type` values are:

- `booking-requested`
- `booking-canceled`
- `booking-late-canceled`

The headings `booking.Requested`, `booking.Cancelation`, and
`booking.LateCancelation` in Wellhub material are conceptual event names, not
the JSON strings.

For a request, WAVE validates the gym, mapped slot/class, class state, start
time, duplicate booking, matched-user duplicate, and capacity. WAVE then calls:

`PATCH /booking/v2/gyms/{gym_id}/bookings/{booking_number}`

with `RESERVED` or `REJECTED`. Rejections use only Wellhub's documented reason
categories, including `CLASS_IS_FULL`, `USER_IS_ALREADY_BOOKED`,
`CLASS_HAS_BEEN_CANCELED`, `CLASS_NOT_FOUND`, and
`CHECK_IN_AND_CANCELATION_WINDOWS_CLOSED`.

Normal and late cancellation both preserve the booking row, set it to
`CANCELED`, release its seat, and run WAVE's existing FIFO waitlist promotion.
Late cancellation additionally records `LATE_CANCELED` and a timestamp. It does
not apply WAVE's corporate monetary/booking-block behavior.

If an admin, coach, or matched user cancels a Wellhub-originated booking in
WAVE, WAVE sends `CANCELLED_BY_GYM` to Wellhub and updates the slot count.

## Idempotency and failure recovery

`WellhubBookingEvent.externalEventId` is unique, and `(eventType,
bookingNumber)` is also unique. `Booking.wellhubBookingNumber` is unique. Event
records store identifiers and sanitized outcomes only; raw webhooks, signatures,
emails, tokens, and secrets are not stored.

- Duplicate successful events are acknowledged without another booking.
- A concurrent duplicate still marked `PROCESSING` receives HTTP 503 so the
  provider retries after the durable outcome is known.
- Two final-seat requests serialize; at most one creates a booking.
- If WAVE commits but `RESERVED` confirmation times out, the booking remains in
  `CONFIRMATION_ERROR`. A redelivery claims the errored event and confirms the
  same booking rather than creating another one.
- If slot/class sync fails, the local mutation remains committed and the class
  records `wellhubSyncStatus=ERROR` plus a sanitized error code.
- The explicit sync command reconciles future class/slot state, active pending
  confirmations, and up to 500 pending `CANCELLED_BY_GYM` notifications.
- A full, canceled, closed, or missing class is rejected with the documented
  Wellhub reason; it is never added to WAVE's waitlist.

Wellhub documents a one-second webhook response target and three immediate
retries after no response. Booking decisions are allowed up to 15 minutes,
after which Wellhub automatically rejects. The client timeout stays below one
second; retryable confirmation/network failures return HTTP 503 and remain
reconcilable.

## Environment variables

Server-side names only:

- `WELLHUB_BOOKING_ENABLED`
- `WELLHUB_BOOKING_API_BASE_URL`
- `WELLHUB_BOOKING_PRODUCT_ID`
- `WELLHUB_BOOKING_CATEGORY_IDS`
- `WELLHUB_BOOKING_SYNC_HORIZON_DAYS`
- `WELLHUB_API_TOKEN`
- `WELLHUB_GYM_ID`
- `WELLHUB_WEBHOOK_SECRET`
- `WELLHUB_API_TIMEOUT_MS`
- `WELLHUB_CHECKIN_ENABLED`

`WELLHUB_BOOKING_ENABLED=false` is the safe default. Never use `NEXT_PUBLIC_*`
for these values and never share DEV/sandbox values with UAT or production.

## Initial DEV sync

Run the no-network preflight first:

```bash
npm run wellhub:booking:sandbox:check
```

Preview future classes inside the configured 1–90 day horizon:

```bash
npm run wellhub:booking:sync -- --dry-run
```

Run the explicit idempotent DEV-to-sandbox sync:

```bash
npm run wellhub:booking:sync
```

The command is never invoked by build, startup, migration, or deployment.

## Sandbox certification with Marco / Wellhub

1. Marco supplies the DEV sandbox gym ID, Booking product ID, Bearer token,
   webhook secret, and optional valid `es_MX` category IDs.
2. Configure the variables in DEV only and register
   `https://<dev-host>/api/integrations/wellhub/webhook` as the single callback.
3. Run preflight and dry-run, then run the initial sync.
4. In the official Bruno/Postman-equivalent collection, list the Wellhub class
   and slot and verify WAVE title/time/capacity/count.
5. Use the official helper request:
   `POST /helper/v1/gyms/{gym_id}/simulate/bookings` with a 13-digit sandbox
   user, the synced class ID, and slot ID.
6. Verify the signed `booking-requested` delivery returns `RESERVED`, creates
   exactly one active WAVE booking, and reduces shared WAVE availability.
7. Verify Wellhub slot `total_booked` equals WAVE's active quantity sum.
8. Use `POST /helper/v1/gyms/{gym_id}/simulate/bookings/{booking_number}/cancel`.
9. Verify `booking-canceled` or `booking-late-canceled` cancels the same WAVE
   booking, releases/promotes the seat according to WAVE rules, performs no
   credit refund, and updates `total_booked`.
10. Repeat both webhook deliveries to prove idempotency, then simulate a
    provider timeout once to prove split-brain recovery.

Do not run these helper requests in automated tests. Standard tests mock all
Wellhub HTTP calls.

## Information required from Wellhub

The integration cannot be enabled until Marco/Wellhub provides or confirms:

- DEV sandbox gym ID
- DEV sandbox Booking product ID applicable to the studio classes
- DEV sandbox Bearer token
- webhook signing secret and registered DEV callback
- optional category IDs to associate (or confirmation to omit categories)
- actual sandbox redelivery behavior for a promptly returned HTTP 503
