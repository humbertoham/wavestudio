# Source audit: main to validated UAT

Audit timestamp: 2026-07-18 (local release preparation).

- `origin/main`: `de3f8c89e778cc5e399bf6114af5b00c41c7e8ed`
- `origin/uat`: `e2c4de101154717730fecbdb125db373e9e172fa`
- `origin/dev`: `338db564da547cec662961bf1f2b31f0a67f8039`
- Merge base: `14e81a4f765e3d05ef14fb91583159efa0aac6d4`
- Source diff before release-package additions: 124 files, 14,664 insertions, 786 deletions.
- The branches were divergent; neither tip was an ancestor of the other.
- Local environment files are ignored. The only tracked environment file is the placeholder-only `.env.example`.

## Commits in origin/main..origin/uat

```text
e2c4de1 (origin/uat, uat) Schedule month-end corporate renewal
e146cb4 Simplify WellHub confirmation submit
97f387c Fix WellHub confirmation response handling
36f80c8 Bound WellHub confirmation loading time
60d7569 Retry lost WellHub confirmation response once
5c5e366 Fix WellHub confirmation session recovery
5dd9e42 Reset WellHub confirmations and edit Challenge points
703ba41 Fix calendar deletion, Challenge resets, and WellHub redirect
a6f6521 Add forced WellHub plan reconfirmation
c9884f8 Document Challenge manual UAT checklist
0ffd94c Implement transactional Challenge feature
4b57a3a Fix new user badge classification
7aee5e0 Fix admin class deletion with canceled history
784e7ff Synchronize WellHub plan credits
0f6b081 Fix branch database runner on Windows
c6f7773 Reject placeholder branch database URLs
05caa61 Add safe UAT migration checks for signup
54cac38 Implement WellHub plan entitlements
```

Production-only commits retained during conflict resolution:

```text
3d63add Fix monthly corporate renewal timing
7b6965e Remove dev-only schema requirements from production
de3f8c8 Restore coach class management permissions
```

The schema-prohibition test introduced by `de3f8c8` was intentionally removed because this release now includes the previously deferred WellHub plan migrations. COACH authorization and Monterrey package-expiration behavior were preserved.

## Exact file status in origin/main...origin/uat

```text
M	.env.example
A	docs/challenge.md
M	docs/environments.md
A	docs/wellhub-credit-sync.md
A	docs/wellhub-plan-reconfirmation.md
M	middleware.ts
M	package.json
A	prisma/migrations/20260630000000_add_wellhub_plan_affiliation_confirmation/migration.sql
A	prisma/migrations/20260713000000_add_wellhub_credit_traceability/migration.sql
A	prisma/migrations/20260713010000_add_challenge/migration.sql
A	prisma/migrations/20260713020000_add_wellhub_plan_confirmation/migration.sql
A	prisma/migrations/20260717010000_add_class_deleted_at/migration.sql
A	prisma/migrations/20260718010000_add_challenge_point_adjustment/migration.sql
A	prisma/migrations/20260718020000_add_wellhub_session_transition/migration.sql
M	prisma/schema.prisma
A	scripts/branch-db.mjs
A	scripts/repair-wellhub-renewal-state.mjs
A	scripts/require-wellhub-plan-confirmation.mjs
A	scripts/require-wellhub-plan-confirmation.test.ts
A	scripts/verify-challenge-point-editing-app.mjs
A	scripts/verify-wellhub-confirmation-app.mjs
M	src/app/(app)/admin/page.tsx
A	src/app/(app)/admin/wellhub-confirmaciones/page.tsx
M	src/app/(app)/perfil/page.tsx
A	src/app/(auth)/actualizar-plan-wellhub/page.tsx
A	src/app/(auth)/afiliacion/page.tsx
M	src/app/(auth)/register/page.tsx
A	src/app/(marketing)/challenge/page.tsx
M	src/app/(marketing)/clases/[id]/page.tsx
M	src/app/(marketing)/clases/page.tsx
A	src/app/api/admin/bookings/[id]/attendance/route.test.ts
M	src/app/api/admin/bookings/[id]/attendance/route.ts
A	src/app/api/admin/challenge/_auth.test.ts
A	src/app/api/admin/challenge/_auth.ts
A	src/app/api/admin/challenge/leaderboard/route.ts
A	src/app/api/admin/challenge/route.ts
A	src/app/api/admin/challenge/users/[userId]/points/route.test.ts
A	src/app/api/admin/challenge/users/[userId]/points/route.ts
M	src/app/api/admin/classes/[id]/add-guest/route.ts
A	src/app/api/admin/classes/[id]/cancel/route.test.ts
M	src/app/api/admin/classes/[id]/cancel/route.ts
A	src/app/api/admin/classes/[id]/challenge-points/route.ts
A	src/app/api/admin/classes/[id]/route.integration.test.ts
M	src/app/api/admin/classes/[id]/route.test.ts
M	src/app/api/admin/classes/[id]/route.ts
M	src/app/api/admin/classes/route.ts
A	src/app/api/admin/users/[id]/details/route.test.ts
M	src/app/api/admin/users/[id]/details/route.ts
M	src/app/api/admin/users/route.ts
A	src/app/api/admin/wellhub-plan-confirmations/route.test.ts
A	src/app/api/admin/wellhub-plan-confirmations/route.ts
M	src/app/api/auth/login/route.ts
M	src/app/api/auth/logout/route.ts
M	src/app/api/auth/me/route.ts
M	src/app/api/auth/register-corporate.test.ts
M	src/app/api/auth/register/route.ts
M	src/app/api/bookings/route.ts
A	src/app/api/challenge/route.test.ts
A	src/app/api/challenge/route.ts
A	src/app/api/classes/[id]/new-user.integration.test.ts
M	src/app/api/classes/[id]/route.test.ts
M	src/app/api/classes/[id]/route.ts
M	src/app/api/classes/[id]/waitlist/route.ts
A	src/app/api/classes/route.test.ts
M	src/app/api/classes/route.ts
A	src/app/api/internal/monthly-renewal/route.test.ts
M	src/app/api/internal/monthly-renewal/route.ts
A	src/app/api/users/me/affiliation/route.test.ts
A	src/app/api/users/me/affiliation/route.ts
M	src/app/api/users/me/tokens/route.ts
A	src/app/api/users/me/wellhub-plan-confirmation/route.test.ts
A	src/app/api/users/me/wellhub-plan-confirmation/route.ts
M	src/app/api/webhooks/mercadopago/route.test.ts
A	src/app/api/wellhub/plans/route.test.ts
A	src/app/api/wellhub/plans/route.ts
A	src/components/booking/NewUserBadge.test.ts
A	src/components/booking/NewUserBadge.tsx
A	src/components/challenge/ChallengeInfoContent.tsx
A	src/components/challenge/ChallengeNavLink.tsx
A	src/components/challenge/ChallengePointsBadge.tsx
A	src/components/challenge/challenge-ui.test.ts
M	src/components/nav/Navbar.tsx
A	src/lib/affiliation-gate.test.ts
A	src/lib/affiliation-gate.ts
A	src/lib/affiliation.ts
A	src/lib/auth-session-cookie.test.ts
A	src/lib/auth-version.test.ts
M	src/lib/auth.ts
M	src/lib/availability.ts
A	src/lib/challenge-copy.ts
A	src/lib/challenge-point-editor.test.ts
A	src/lib/challenge-point-editor.ts
A	src/lib/challenge-ui.ts
A	src/lib/challenge.integration.test.ts
A	src/lib/challenge.test.ts
A	src/lib/challenge.ts
M	src/lib/class-booking.ts
A	src/lib/class-deletion-response.ts
A	src/lib/class-deletion.ts
A	src/lib/corporate-credits.test.ts
A	src/lib/corporate-credits.ts
M	src/lib/jwt.ts
A	src/lib/new-user.test.ts
A	src/lib/new-user.ts
A	src/lib/session-cookie.test.ts
A	src/lib/session-cookie.ts
A	src/lib/useChallenge.ts
M	src/lib/useSession.ts
A	src/lib/wellhub-config.ts
A	src/lib/wellhub-confirmation-gate.test.ts
A	src/lib/wellhub-confirmation-gate.ts
A	src/lib/wellhub-confirmation-ui.test.ts
A	src/lib/wellhub-confirmation-ui.ts
A	src/lib/wellhub-plan-confirmation.integration.test.ts
A	src/lib/wellhub-plan-confirmation.test.ts
A	src/lib/wellhub-plan-confirmation.ts
A	src/lib/wellhub-session-recovery.test.ts
A	src/lib/wellhub-session-recovery.ts
A	src/lib/wellhub.ts
M	src/lib/zod.ts
A	src/proxy.test.ts
A	src/proxy.ts
M	vercel.json
M	vitest.config.ts
```

## Exact source diff stat

```text
.env.example                                       |   7 +
 docs/challenge.md                                  |  96 +++
 docs/environments.md                               |  23 +
 docs/wellhub-credit-sync.md                        |  51 ++
 docs/wellhub-plan-reconfirmation.md                | 117 +++
 middleware.ts                                      | 167 +++-
 package.json                                       |   9 +
 .../migration.sql                                  |   7 +
 .../migration.sql                                  |  10 +
 .../20260713010000_add_challenge/migration.sql     | 134 +++
 .../migration.sql                                  |  54 ++
 .../migration.sql                                  |   5 +
 .../migration.sql                                  |  49 ++
 .../migration.sql                                  |  18 +
 prisma/schema.prisma                               | 275 ++++++-
 scripts/branch-db.mjs                              | 162 ++++
 scripts/repair-wellhub-renewal-state.mjs           | 249 ++++++
 scripts/require-wellhub-plan-confirmation.mjs      | 407 +++++++++
 scripts/require-wellhub-plan-confirmation.test.ts  | 387 +++++++++
 scripts/verify-challenge-point-editing-app.mjs     | 338 ++++++++
 scripts/verify-wellhub-confirmation-app.mjs        | 509 ++++++++++++
 src/app/(app)/admin/page.tsx                       | 912 ++++++++++++++++++++-
 .../(app)/admin/wellhub-confirmaciones/page.tsx    | 208 +++++
 src/app/(app)/perfil/page.tsx                      |  63 +-
 src/app/(auth)/actualizar-plan-wellhub/page.tsx    | 240 ++++++
 src/app/(auth)/afiliacion/page.tsx                 | 212 +++++
 src/app/(auth)/register/page.tsx                   |  44 +-
 src/app/(marketing)/challenge/page.tsx             |  51 ++
 src/app/(marketing)/clases/[id]/page.tsx           |  84 +-
 src/app/(marketing)/clases/page.tsx                |  40 +-
 .../admin/bookings/[id]/attendance/route.test.ts   |  75 ++
 .../api/admin/bookings/[id]/attendance/route.ts    |  52 +-
 src/app/api/admin/challenge/_auth.test.ts          |  46 ++
 src/app/api/admin/challenge/_auth.ts               |  34 +
 src/app/api/admin/challenge/leaderboard/route.ts   |  88 ++
 src/app/api/admin/challenge/route.ts               |  81 ++
 .../challenge/users/[userId]/points/route.test.ts  | 132 +++
 .../admin/challenge/users/[userId]/points/route.ts |  79 ++
 src/app/api/admin/classes/[id]/add-guest/route.ts  |   2 +-
 .../api/admin/classes/[id]/cancel/route.test.ts    |  90 ++
 src/app/api/admin/classes/[id]/cancel/route.ts     |  58 +-
 .../admin/classes/[id]/challenge-points/route.ts   |  54 ++
 .../admin/classes/[id]/route.integration.test.ts   | 281 +++++++
 src/app/api/admin/classes/[id]/route.test.ts       | 296 ++++++-
 src/app/api/admin/classes/[id]/route.ts            |  77 +-
 src/app/api/admin/classes/route.ts                 |  23 +-
 src/app/api/admin/users/[id]/details/route.test.ts | 164 ++++
 src/app/api/admin/users/[id]/details/route.ts      | 160 +++-
 src/app/api/admin/users/route.ts                   |  54 +-
 .../admin/wellhub-plan-confirmations/route.test.ts | 113 +++
 .../api/admin/wellhub-plan-confirmations/route.ts  | 138 ++++
 src/app/api/auth/login/route.ts                    |  22 +-
 src/app/api/auth/logout/route.ts                   |  25 +-
 src/app/api/auth/me/route.ts                       |  57 +-
 src/app/api/auth/register-corporate.test.ts        | 230 +++++-
 src/app/api/auth/register/route.ts                 | 129 +--
 src/app/api/bookings/route.ts                      |   6 +-
 src/app/api/challenge/route.test.ts                |  48 ++
 src/app/api/challenge/route.ts                     |  30 +
 .../api/classes/[id]/new-user.integration.test.ts  | 354 ++++++++
 src/app/api/classes/[id]/route.test.ts             | 126 ++-
 src/app/api/classes/[id]/route.ts                  | 105 +--
 src/app/api/classes/[id]/waitlist/route.ts         |   2 +-
 src/app/api/classes/route.test.ts                  |  51 ++
 src/app/api/classes/route.ts                       |  20 +-
 src/app/api/internal/monthly-renewal/route.test.ts | 242 ++++++
 src/app/api/internal/monthly-renewal/route.ts      | 510 ++++++------
 src/app/api/users/me/affiliation/route.test.ts     | 132 +++
 src/app/api/users/me/affiliation/route.ts          | 114 +++
 src/app/api/users/me/tokens/route.ts               |  35 +-
 .../me/wellhub-plan-confirmation/route.test.ts     | 243 ++++++
 .../users/me/wellhub-plan-confirmation/route.ts    | 221 +++++
 src/app/api/webhooks/mercadopago/route.test.ts     |  13 +-
 src/app/api/wellhub/plans/route.test.ts            |  32 +
 src/app/api/wellhub/plans/route.ts                 |  32 +
 src/components/booking/NewUserBadge.test.ts        |  22 +
 src/components/booking/NewUserBadge.tsx            |   9 +
 src/components/challenge/ChallengeInfoContent.tsx  |  27 +
 src/components/challenge/ChallengeNavLink.tsx      |  19 +
 src/components/challenge/ChallengePointsBadge.tsx  |  16 +
 src/components/challenge/challenge-ui.test.ts      |  78 ++
 src/components/nav/Navbar.tsx                      |  34 +-
 src/lib/affiliation-gate.test.ts                   |  38 +
 src/lib/affiliation-gate.ts                        |  56 ++
 src/lib/affiliation.ts                             |  75 ++
 src/lib/auth-session-cookie.test.ts                |  59 ++
 src/lib/auth-version.test.ts                       |  68 ++
 src/lib/auth.ts                                    |  62 +-
 src/lib/availability.ts                            |   4 +-
 src/lib/challenge-copy.ts                          |  21 +
 src/lib/challenge-point-editor.test.ts             |  33 +
 src/lib/challenge-point-editor.ts                  |  25 +
 src/lib/challenge-ui.ts                            |  23 +
 src/lib/challenge.integration.test.ts              | 767 +++++++++++++++++
 src/lib/challenge.test.ts                          | 177 ++++
 src/lib/challenge.ts                               | 821 +++++++++++++++++++
 src/lib/class-booking.ts                           |   2 +-
 src/lib/class-deletion-response.ts                 |  95 +++
 src/lib/class-deletion.ts                          | 130 +++
 src/lib/corporate-credits.test.ts                  | 357 ++++++++
 src/lib/corporate-credits.ts                       | 418 ++++++++++
 src/lib/jwt.ts                                     |   9 +-
 src/lib/new-user.test.ts                           | 110 +++
 src/lib/new-user.ts                                |  61 ++
 src/lib/session-cookie.test.ts                     |  80 ++
 src/lib/session-cookie.ts                          |  97 +++
 src/lib/useChallenge.ts                            |  42 +
 src/lib/useSession.ts                              |  13 +-
 src/lib/wellhub-config.ts                          |  22 +
 src/lib/wellhub-confirmation-gate.test.ts          |  45 +
 src/lib/wellhub-confirmation-gate.ts               |  38 +
 src/lib/wellhub-confirmation-ui.test.ts            | 167 ++++
 src/lib/wellhub-confirmation-ui.ts                 |  59 ++
 .../wellhub-plan-confirmation.integration.test.ts  | 478 +++++++++++
 src/lib/wellhub-plan-confirmation.test.ts          | 182 ++++
 src/lib/wellhub-plan-confirmation.ts               | 202 +++++
 src/lib/wellhub-session-recovery.test.ts           | 101 +++
 src/lib/wellhub-session-recovery.ts                | 159 ++++
 src/lib/wellhub.ts                                 | 178 ++++
 src/lib/zod.ts                                     |  31 +
 src/proxy.test.ts                                  | 117 +++
 src/proxy.ts                                       |  13 +
 vercel.json                                        |   4 +-
 vitest.config.ts                                   |   2 +-
 124 files changed, 14664 insertions(+), 786 deletions(-)
```

## Deployment/configuration findings

- No GitHub Actions deployment workflow or repository release automation was found.
- The package build command runs Prisma client generation and Next.js build; it does not run `prisma migrate deploy`.
- The Vercel cron invokes the existing monthly-renewal endpoint at `05:00 UTC` on the first day following months with a day 31, corresponding to `23:00 America/Monterrey` on calendar day 31.
- No linked `.vercel/project.json`, Vercel/Neon CLI installation, API token, or Neon project ID was available.
- Therefore the production Git branch setting, current production deployment/aliases, Vercel plan, Production variable presence, Neon root branch identity, restore window, and recovery point cannot be certified locally.
- No existing production release/rollback package was found; this release adds one under this directory.
