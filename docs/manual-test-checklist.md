# Manual Test Checklist

This repo does not currently have a test runner or seeded integration fixtures for auth, Prisma, and cron flows. For the cases below, the most practical coverage is a repeatable manual checklist using:

- `npm run dev`
- `npx prisma studio`
- PowerShell plus `curl.exe`

Use `curl.exe`, not `curl`, because PowerShell aliases `curl` to `Invoke-WebRequest`.

## Prerequisites

1. Start the app:

```powershell
npm run dev
```

2. In a second terminal, open Prisma Studio:

```powershell
npx prisma studio
```

3. For the cron auth checks, make sure your local `.env` contains a `CRON_SECRET` value and restart `npm run dev` after setting it.

## Shared Setup

Run this once in PowerShell to create unique test users and cookie files:

```powershell
$Base = "http://localhost:3000"
$RunId = Get-Date -Format "yyyyMMddHHmmss"
$CookieDir = Join-Path $PWD "tmp/manual-cookies"
New-Item -ItemType Directory -Force -Path $CookieDir | Out-Null

function Register-TestUser {
  param(
    [string]$Name,
    [string]$Email,
    [string]$Password = "Passw0rd!"
  )

  $payload = @{
    name = $Name
    email = $Email
    password = $Password
    dateOfBirth = "1995-05-15"
    phone = "5551234567"
    emergencyPhone = "5557654321"
    affiliation = "NONE"
  } | ConvertTo-Json -Compress

  curl.exe -s -X POST "$Base/api/register" `
    -H "Content-Type: application/json" `
    --data-raw $payload | ConvertFrom-Json
}

function Login-TestUser {
  param(
    [string]$Email,
    [string]$Password,
    [string]$CookieFile
  )

  $payload = @{
    email = $Email
    password = $Password
  } | ConvertTo-Json -Compress

  curl.exe -s -X POST "$Base/api/auth/login" `
    -H "Content-Type: application/json" `
    --data-raw $payload `
    -c $CookieFile | ConvertFrom-Json
}

$HolderEmail = "manual-holder-$RunId@example.com"
$WaitAEmail = "manual-waita-$RunId@example.com"
$WaitBEmail = "manual-waitb-$RunId@example.com"
$CreditEmail = "manual-credit-$RunId@example.com"

$Holder = Register-TestUser "Manual Holder" $HolderEmail
$WaitA = Register-TestUser "Manual Wait A" $WaitAEmail
$WaitB = Register-TestUser "Manual Wait B" $WaitBEmail
$CreditUser = Register-TestUser "Manual Credit User" $CreditEmail

$HolderCookie = Join-Path $CookieDir "holder.txt"
$WaitACookie = Join-Path $CookieDir "wait-a.txt"
$WaitBCookie = Join-Path $CookieDir "wait-b.txt"
$CreditCookie = Join-Path $CookieDir "credit.txt"

Login-TestUser $HolderEmail "Passw0rd!" $HolderCookie | Out-Null
Login-TestUser $WaitAEmail "Passw0rd!" $WaitACookie | Out-Null
Login-TestUser $WaitBEmail "Passw0rd!" $WaitBCookie | Out-Null
Login-TestUser $CreditEmail "Passw0rd!" $CreditCookie | Out-Null

$Holder
$WaitA
$WaitB
$CreditUser
```

Keep the four returned user IDs. You will need them in Prisma Studio.

## Test Data Setup In Prisma Studio

Create the minimum data below in Prisma Studio:

1. In `Instructor`, create one row:
   - `name`: `Manual Test Coach`

2. In `Pack`, create one row:
   - `name`: `Manual Test Pack`
   - `classes`: `6`
   - `price`: `0`
   - `validityDays`: `30`
   - `isActive`: `true`
   - `isVisible`: `false`
   - `oncePerUser`: `false`

3. In `Class`, create two future rows more than 5 hours ahead of the current time:
   - `Class A`
   - `title`: `Manual Waitlist Class`
   - `focus`: `Manual`
   - `durationMin`: `60`
   - `capacity`: `1`
   - `creditCost`: `3`
   - `instructorId`: the instructor you created
   - `Class B`
   - `title`: `Manual CreditCost Class`
   - `focus`: `Manual`
   - `durationMin`: `60`
   - `capacity`: `2`
   - `creditCost`: `3`
   - `instructorId`: the same instructor

4. In `PackPurchase`, create these rows:
   - For `$Holder.id`: `classesLeft = 3`, `expiresAt` in the future, `packId` = manual test pack ID
   - For `$WaitA.id`: `classesLeft = 3`, `expiresAt` in the future, `packId` = manual test pack ID
   - For `$WaitB.id`: `classesLeft = 3`, `expiresAt` in the future, `packId` = manual test pack ID
   - For `$CreditUser.id`: `classesLeft = 6`, `expiresAt` in the future, `packId` = manual test pack ID

You do not need to create `TokenLedger` rows for the initial manual balances. The booking and cancellation flows create their own ledger entries during the test.

Keep both class IDs for the next sections:

- `ClassAId` = `Manual Waitlist Class`
- `ClassBId` = `Manual CreditCost Class`

## 1. Register Route Success And Failure

### Success

```powershell
$RegisterOkPayload = @{
  name = "Manual Register Success"
  email = "manual-register-success-$RunId@example.com"
  password = "Passw0rd!"
  dateOfBirth = "1994-04-20"
  phone = "5551112233"
  emergencyPhone = "5553332211"
  affiliation = "NONE"
} | ConvertTo-Json -Compress

curl.exe -i -X POST "$Base/api/register" `
  -H "Content-Type: application/json" `
  --data-raw $RegisterOkPayload
```

Expected:

- HTTP `201`
- JSON contains `id`, `email`, and `requestId`
- The new email appears in Prisma Studio under `User`

### Failure: invalid body

```powershell
$RegisterBadPayload = @{
  name = "Bad Register"
  email = "manual-register-bad-$RunId@example.com"
  password = "short"
  dateOfBirth = "2099-01-01"
  phone = "123"
  emergencyPhone = "123"
  affiliation = "NONE"
} | ConvertTo-Json -Compress

curl.exe -i -X POST "$Base/api/register" `
  -H "Content-Type: application/json" `
  --data-raw $RegisterBadPayload
```

Expected:

- HTTP `400`
- JSON `error = "INVALID_BODY"`
- `fields` includes at least `password`, `dateOfBirth`, `phone`, and `emergencyPhone`

### Failure: duplicate email

Run the same success payload a second time.

Expected:

- HTTP `409`
- JSON `error = "EMAIL_IN_USE"`

## 2. `/api/users/me/tokens` Spoofing And Unauthenticated Safety

This endpoint intentionally returns a safe anonymous payload for unauthenticated callers because the frontend uses it during public page boot. The regression to check is that it no longer trusts spoofed identity inputs.

### Anonymous request

```powershell
curl.exe -s "$Base/api/users/me/tokens" | ConvertFrom-Json
```

Expected:

- `authenticated` is `false`
- `tokens` is `0`
- `affiliation` is `"NONE"`
- `bookingBlocked` is `false`

### Spoofed header should be ignored

```powershell
curl.exe -s `
  -H "x-user-id: $($Holder.id)" `
  "$Base/api/users/me/tokens" | ConvertFrom-Json
```

Expected:

- Same anonymous payload as above
- No data from `$Holder.id` is returned

### Spoofed query param should be ignored

```powershell
curl.exe -s `
  "$Base/api/users/me/tokens?userId=$($Holder.id)" | ConvertFrom-Json
```

Expected:

- Same anonymous payload as above
- No data from `$Holder.id` is returned

## 3. `/api/internal/monthly-renewal` Missing Or Invalid `CRON_SECRET`

### Missing auth header

```powershell
curl.exe -i "$Base/api/internal/monthly-renewal"
```

Expected when local `CRON_SECRET` is configured:

- HTTP `401`
- JSON `message = "UNAUTHORIZED"`

If you get `500` with `CRON_SECRET_MISSING`, add `CRON_SECRET` to local `.env`, restart `npm run dev`, and repeat.

### Invalid auth header

```powershell
curl.exe -i `
  -H "Authorization: Bearer definitely-wrong" `
  "$Base/api/internal/monthly-renewal"
```

Expected:

- HTTP `401`
- JSON `message = "UNAUTHORIZED"`

### Valid auth header

```powershell
curl.exe -i `
  -H "Authorization: Bearer $env:CRON_SECRET" `
  "$Base/api/internal/monthly-renewal"
```

Expected:

- On any UTC day other than the 1st: HTTP `400` with the day-guard message
- On the 1st after a prior run: a non-auth error such as `Ya ejecutado este mes`
- The important check is that the request gets past auth when the header matches

For Vercel Cron, set `CRON_SECRET` in the project environment. Vercel sends it automatically as `Authorization: Bearer <CRON_SECRET>` on cron invocations.

## 4. Waitlist Promotion Must Skip Users Without Credits

### Fill the class

```powershell
$ClassAId = "<replace-with-Manual-Waitlist-Class-id>"

$HolderBooking = curl.exe -s -X POST "$Base/api/bookings" `
  -H "Content-Type: application/json" `
  -b $HolderCookie `
  --data-raw (@{
    classId = $ClassAId
    quantity = 1
  } | ConvertTo-Json -Compress) | ConvertFrom-Json

$HolderBooking
```

Expected:

- HTTP success payload with `ok = true`
- `debitedCredits = 3`
- Save `$HolderBooking.bookingId`

### Add both users to the waitlist

```powershell
curl.exe -i -X POST "$Base/api/classes/$ClassAId/waitlist" -b $WaitACookie
curl.exe -i -X POST "$Base/api/classes/$ClassAId/waitlist" -b $WaitBCookie
```

Expected:

- First response returns `position = 1`
- Second response returns `position = 2`

### Simulate user A losing credits after joining

In Prisma Studio, find the active `PackPurchase` for `$WaitA.id` and set either:

- `classesLeft = 0`

or

- `expiresAt` to a past timestamp

Do not remove the waitlist row.

### Cancel the original booking

```powershell
curl.exe -i -X PATCH "$Base/api/bookings/$($HolderBooking.bookingId)/cancel" -b $HolderCookie
```

Expected:

- HTTP `200`
- JSON `lateCancel = false`
- JSON `refundedCredits = 3`

### Verify user A was skipped and user B was promoted

```powershell
curl.exe -s "$Base/api/users/me/bookings" -b $WaitACookie | ConvertFrom-Json
curl.exe -s "$Base/api/users/me/bookings" -b $WaitBCookie | ConvertFrom-Json
curl.exe -s "$Base/api/users/me/tokens" -b $WaitACookie | ConvertFrom-Json
curl.exe -s "$Base/api/users/me/tokens" -b $WaitBCookie | ConvertFrom-Json
```

Expected:

- Wait user A has no new active booking for `ClassAId`
- Wait user A no longer has enough credits and their stale waitlist entry is gone in Prisma Studio
- Wait user B now has an active booking for `ClassAId`
- Wait user B token balance dropped by `3`

This is the regression check for the previous stall: the promotion must continue past an ineligible waitlist user instead of stopping the whole chain.

## 5. Booking And Cancellation Must Respect `creditCost`

This check proves the system uses `creditCost`, not a hardcoded `1`, for both debit and refund.

### Confirm starting balance

```powershell
curl.exe -s "$Base/api/users/me/tokens" -b $CreditCookie | ConvertFrom-Json
```

Expected:

- `authenticated = true`
- `tokens = 6`

### Book two spots on the `creditCost = 3` class

```powershell
$ClassBId = "<replace-with-Manual-CreditCost-Class-id>"

$CreditBooking = curl.exe -s -X POST "$Base/api/bookings" `
  -H "Content-Type: application/json" `
  -b $CreditCookie `
  --data-raw (@{
    classId = $ClassBId
    quantity = 2
  } | ConvertTo-Json -Compress) | ConvertFrom-Json

$CreditBooking
curl.exe -s "$Base/api/users/me/tokens" -b $CreditCookie | ConvertFrom-Json
```

Expected:

- Booking response has `debitedCredits = 6`
- Booking response has `creditCost = 3`
- Token balance after booking is `0`

### Cancel the booking

```powershell
curl.exe -s -X PATCH "$Base/api/bookings/$($CreditBooking.bookingId)/cancel" `
  -b $CreditCookie | ConvertFrom-Json

curl.exe -s "$Base/api/users/me/tokens" -b $CreditCookie | ConvertFrom-Json
```

Expected:

- Cancel response has `lateCancel = false`
- Cancel response has `refundedCredits = 6`
- `class.creditCost = 3` in the response
- Token balance after cancel returns to `6`

## Optional Browser Cross-Check

If you want to confirm the UI matches the API behavior:

1. Sign in through `/login` with the same test users.
2. Use `/clases` to verify that the reserve modal shows the real per-seat cost for the manual classes.
3. Use `/mis-clases` to confirm the canceled booking moves out of active state after cancellation.
