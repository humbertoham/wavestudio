# Wellhub Access Control check-in integration

## Architecture

```text
Wellhub App
  -> Wellhub check-in webhook
  -> WAVE POST /api/integrations/wellhub/webhook
  -> raw-body HMAC-SHA1 verification
  -> payload validation and deterministic idempotency key
  -> Wellhub Access Control POST /access/v1/validate
  -> WellhubCheckin AUTHORIZED | REJECTED | ERROR
```

The integration handles only the Access Control check-in event. Booking API
events are acknowledged as unsupported and are not processed. Check-ins do not
create WAVE bookings, packages, credits, users, affiliation changes, or access
device actions.

The official check-in payload does not contain an event ID or check-in ID. WAVE
therefore derives `externalEventId` as a SHA-256 hash of provider, event type,
`unique_token`, gym ID, product ID, and event timestamp. Wellhub describes the
timestamp as the event creation timestamp, rather than a delivery timestamp.
A unique database constraint is the final concurrency guard.

Wellhub's public documentation does not explicitly guarantee that a redelivery
preserves the original timestamp or all payload fields. The strategy therefore
uses the best documented semantic identity available, but timestamp stability
must be confirmed with Wellhub or observed during the first sandbox redelivery.
Two otherwise identical events with different creation timestamps produce
different records, so a later same-user check-in is not suppressed. Wellhub's
FAQ separately states that only one daily check-in is normally allowed per user.

The raw payload is not stored. The audit row contains only the identifiers and
outcome needed to troubleshoot validation. An optional WAVE user association is
made only when the webhook includes an email that exactly matches WAVE's unique
email for an existing `WELLHUB`-affiliated user. No account is created, merged,
or modified, and an unmatched user can still be authorized by Wellhub.

## Configuration

All values are server-only. Do not use `NEXT_PUBLIC_*` names.

- `WELLHUB_CHECKIN_ENABLED`: `true` enables processing; absent or `false` is the
  safe default.
- `WELLHUB_API_BASE_URL`: use
  `https://apitesting.partners.gympass.com/access/v1` for development/sandbox.
  The client rejects non-Wellhub hosts and non-HTTPS URLs.
- `WELLHUB_API_TOKEN`: sandbox Bearer token supplied by Wellhub Technical Sales.
- `WELLHUB_GYM_ID`: sandbox Wellhub gym/location ID sent as `X-Gym-Id`.
- `WELLHUB_WEBHOOK_SECRET`: secret supplied by Wellhub for webhook validation.
- `WELLHUB_API_TIMEOUT_MS`: optional integer from 100 through 900; defaults to
  800 to remain below Wellhub's documented one-second webhook response window.

`.env.example` documents the shared placeholders. For local automated tests,
copy `.env.test.example` to ignored `.env.test` only if the local runner needs
an env file. The committed example contains fake values and a local-only fake
database URL.

## Sandbox setup

1. Obtain the sandbox Bearer token, webhook secret, and sandbox gym ID from the
   Wellhub technical contact.
2. Configure the variables above in the development environment only.
3. Apply the new Prisma migration only to the confirmed development database.
4. Expose the development deployment or local server through an externally
   managed public HTTPS URL. Localhost is not reachable by Wellhub. No tunnel
   dependency is included in this repository.
5. Register this callback with Wellhub:

   `https://<public-development-host>/api/integrations/wellhub/webhook`

6. Set `WELLHUB_CHECKIN_ENABLED=true` only after the other configuration is
   ready.
7. Run `npm run wellhub:sandbox:check` in the configured development runtime.
   The preflight validates the feature flag, required variable presence,
   official sandbox target, gym ID format, timeout, non-production context, and
   webhook route without printing secrets or sending a network request.

The official sandbox validation endpoint is
`POST https://apitesting.partners.gympass.com/access/v1/validate`. WAVE sends
`Authorization: Bearer ...`, `X-Gym-Id`, `Content-Type: application/json`, and
the body `{ "gympass_id": "<13-digit Wellhub ID>" }`.

## Signature validation

The current official Wellhub Access Control documentation names the webhook
header `X-Gympass-Signature` (despite the Gympass-to-Wellhub rename). WAVE
computes HMAC-SHA1 over the exact raw request bytes with the webhook secret,
encodes the digest as uppercase hexadecimal, and compares it in constant time.
The documented optional `0X` example prefix is accepted. Missing, malformed, or
invalid signatures are rejected before JSON parsing, persistence, user lookup,
or external validation.

The integration intentionally does not accept the conflicting
`X-API-Signature` name from the implementation request. Confirm any future
header-name change with Wellhub and update the contract tests before changing
this behavior.

## Results and webhook responses

- `AUTHORIZED`: Wellhub returned a successful validation.
- `REJECTED`: Wellhub returned a documented 400/404 business result such as
  missing, canceled, expired, or already validated check-in.
- `ERROR`: authentication, rate limit, server, malformed response, network, or
  timeout failure. Transient errors return HTTP 503; non-retryable credential or
  request errors are acknowledged with HTTP 200 to avoid an immediate retry
  storm and remain visible in the audit table.
- Duplicate `AUTHORIZED` or `REJECTED` events return HTTP 200 without another
  Wellhub call. A previously `ERROR` event may atomically claim one new attempt;
  Wellhub documents the validation endpoint as safe to repeat after a timeout.
- Malformed signed payloads return HTTP 400; invalid signatures return 401;
  unsupported signed event types return 200; disabled/unconfigured integration
  returns 503 without business processing.

Wellhub documents a one-second response window followed by three immediate
retries when no response is received. It does not explicitly state whether an
HTTP 503 response triggers those retries. Keep the validation timeout below that
window, monitor `ERROR` rows and structured `WELLHUB_WEBHOOK_*` logs, and verify
503 redelivery behavior during sandbox certification.

## Pre-sandbox response matrix

| WAVE result | HTTP status | Documented Wellhub retry expectation |
| --- | ---: | --- |
| Invalid signature | 401 | No status-based behavior documented |
| Malformed signed payload | 400 | No status-based behavior documented |
| Unsupported signed event | 200 | No retry expected |
| Duplicate | 200 | No retry expected |
| Authorized | 200 | No retry expected |
| Rejected ticket | 200 | No retry expected |
| API timeout, 429, 5xx, or network error | 503 | Must be confirmed; Wellhub only documents retry after no response within 1 second |
| Invalid API credentials | 200 | No retry expected; operator action required |
| Disabled or invalid WAVE configuration | 503 | Must be confirmed; operator action required |

The first sandbox exercise must compare `eventTimestamp` and
`externalEventId` across an actual Wellhub redelivery and confirm whether the
provider retries a promptly returned HTTP 503.

## Troubleshooting

- `INVALID_SIGNATURE`: confirm the exact raw body, webhook secret, and official
  `X-Gympass-Signature` header. Do not reserialize JSON before hashing.
- `WELLHUB_NOT_CONFIGURED`: enablement is true but one or more required values
  are missing or invalid.
- `HTTP_401` / `HTTP_403`: sandbox Bearer token or gym authorization is invalid.
- Duplicate response: the same stable check-in event was already recorded; no
  action is required unless its stored state is `ERROR`.
- `WELLHUB_TIMEOUT`, rate limit, or server error: the row remains auditable as
  `ERROR` and a redelivery can safely retry it.
- `INVALID_CHECKIN_EVENT`: the signed JSON does not match the documented
  check-in payload, including a 13-digit Wellhub ID, gym/product IDs, and
  timestamp.

Official references:

- [Wellhub Access Control getting started](https://developers.wellhub.com/product/access-control-api/1.0/getting-started)
- [Wellhub Access Control endpoint](https://developers.wellhub.com/product/access-control-api/1.0/endpoints)
- [Wellhub check-in webhook](https://developers.wellhub.com/product/access-control-api/1.0/check-in-webhook)
- [Official sandbox Postman guide](https://documenter.getpostman.com/view/14766562/2s9YsGhCsh)
