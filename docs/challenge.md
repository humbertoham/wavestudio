# WAVE Challenge

## Existing architecture reviewed

- The admin experience is a client-rendered tabbed page at `/admin`; class creation and row editing use `/api/admin/classes`.
- Admin authorization uses `requireAdmin`. Class detail management and attendance use `requireClassManager`, which preserves existing `ADMIN` and `COACH` access without granting coaches broader admin access.
- Class attendance is toggled from `/clases/[id]` through `/api/admin/bookings/[id]/attendance`. Attendance supports both marking and unmarking.
- Registered bookings have `Booking.userId`; guest bookings have `guestName` and no user. Active/cancelled booking status, attendance, waitlist rows, and `Class.isCanceled` remain the source of truth for existing class behavior.
- Credits are derived from active `PackPurchase` rows and audited through `TokenLedger`. Challenge points do not write either model.
- Existing high-contention booking and class flows use serializable Prisma transactions with bounded `P2034` retries. The Challenge follows that convention and adds a PostgreSQL transaction advisory lock for lifecycle-sensitive operations.
- The UI uses the existing card, table, button, input, loading, inline status, native `confirm`, and native `alert` patterns. There is no shared modal/toast component to reuse.
- Prisma migrations use additive timestamped SQL folders. Tests run in Vitest; opt-in integration tests use the configured branch database.

## Lifecycle and eligibility

`Challenge.key = WAVE_CHALLENGE` is the stable singleton. Activation increments `activationVersion`; activation and deactivation both reset current totals and mutable award state to zero/inactive in the same serializable transaction as the lifecycle change. The immutable point ledger is retained as history.

Class eligibility is snapshotted at class creation:

- active: `challengeId`, `challengeEligibleAt`, `challengeActivationVersion`, and default `challengePoints = 1` are persisted;
- inactive: all four fields remain `NULL` permanently;
- existing classes receive no migration default or backfill and remain ineligible;
- reactivation starts current totals at zero. Classes from earlier active periods remain eligible, while classes created during a pause remain ineligible;
- an attendance transition recorded while inactive creates no pending work and is never backfilled.

Lifecycle changes, eligibility snapshots, point edits, attendance, class cancellation, and class deletion take the same advisory lock inside a serializable transaction. The database also has a partial unique index allowing no more than one active Challenge row.

## Award and reversal model

- `ChallengePointLedger` is immutable and records the user, class, booking, actor, signed delta, reason, point snapshot, cycle, metadata, and a unique idempotency key.
- `ChallengeBookingAward` stores the current awarded/reversed state for one Challenge booking and its current cycle. Its unique `(challengeId, bookingId)` key prevents duplicate awards.
- `ChallengeUserTotal` is a transactionally maintained aggregate with a non-negative database check.
- The first award locks the class point value permanently, including after a reversal.
- A reversal subtracts the original snapshot and writes a separate ledger entry. Re-attendance increments the cycle and writes a new award entry.
- Guests, cancelled classes, ineligible classes, duplicate attendance requests, and attendance marked while inactive receive no points.
- Reversals remain available while paused so attendance and existing totals cannot diverge.

## APIs and authorization

- `GET|POST|DELETE /api/admin/challenge`: admin status, activation, and deactivation.
- `GET /api/admin/challenge/leaderboard`: admin-only paginated ranking; points descending, then lowercase name and user ID.
- `PUT /api/admin/classes/:id/challenge-points`: admin-only integer values 1–10; returns `CLASS_CHALLENGE_POINTS_LOCKED` after an award.
- `PATCH /api/admin/bookings/:id/attendance`: existing admin/coach mutation, now atomically returns `{ challenge: { delta, points } }`.
- `GET /api/challenge`: authenticated caller's active state and own total only.

The public user page never includes the leaderboard. Normal users and coaches receive `403 FORBIDDEN` from Challenge admin endpoints.

## UI behavior

- The admin `CHALLENGE` tab shows inactive/active state, Spanish confirmation, lifecycle feedback, and the private paginated leaderboard.
- Eligible class point controls appear only in the class table while active.
- `/perfil` and the class calendar show the star total next to unchanged credits while active.
- Desktop user menu and mobile navigation show `¿Cómo funciona el Challenge?` only while active.
- `/challenge` renders centralized Spanish rules and no leaderboard.

## Verification

Run the normal suite and build:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run build
```

Run database integration tests against a migrated dev or UAT branch database by setting `DATABASE_URL` to that branch URL without printing it:

```powershell
$env:RUN_CHALLENGE_INTEGRATION='1'
npm.cmd test -- src/lib/challenge.integration.test.ts
Remove-Item Env:RUN_CHALLENGE_INTEGRATION
```

The integration suite creates uniquely named fixtures, verifies concurrency and rollback behavior against PostgreSQL, and removes all of its users, classes, bookings, totals, awards, and ledger entries afterward.

## Manual UAT checklist

Use controlled UAT-only users/classes and remove them after verification.

1. While inactive, confirm the admin `CHALLENGE` tab shows `Inactivo`, an activation button, no leaderboard, and that an existing class has no point control.
2. Select `Activar Challenge`; verify the Spanish confirmation dialog before accepting it.
3. Confirm the active status, activation time, concise eligibility explanation, and private leaderboard appear.
4. Create a future class through the admin class form and confirm it shows `Puntos del Challenge` with default `1`.
5. Change the new class to `3`, save, and verify values outside integer range 1–10 are rejected.
6. Add a registered UAT user with booking credits, mark attendance in the existing class-management view, and confirm the 3-point success status.
7. Confirm the leaderboard shows that user with 3 points and deterministic ordering.
8. Unmark attendance and confirm the 3-point reversal status; mark it again and confirm a single re-award.
9. Sign in as the user and verify unchanged remaining booking credits and `3 puntos` with the accessible star on `/perfil` and `/clases`.
10. Verify the desktop user menu and mobile menu show `¿Cómo funciona el Challenge?`; open it and review all centralized Spanish rules. Confirm no leaderboard appears there.
11. Return as admin, deactivate through the Spanish confirmation, and confirm status becomes inactive, current totals reset to zero, and the leaderboard disappears.
12. Return as the user and confirm the point badge and navbar link are hidden and direct `/challenge` access shows the paused state.
13. Inspect UAT data: the preexisting class remains ineligible, the eligible class stores 3, the total is 0, award state is cycle 2/inactive, ledger history is `+3, -3, +3`, and token history contains only normal booking activity.
14. Remove every UAT fixture, confirm the Challenge is inactive, and run `npm.cmd run db:status:uat`.
