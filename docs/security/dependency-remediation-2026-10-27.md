# Dependency security hotfix - October 27, 2026

MAIN baseline: 15915ddb4fc9453b671ba7772a2924acbfa91503. Security branch: security/main-dependency-hardening. No Wellhub feature implementation, schema change, Prisma migration, production environment edit, live record change or activation is included.

The previous locked tree reported 24 affected packages: 2 critical, 15 high, 7 moderate. All critical/high findings and their transitive ancestry were reviewed. The patched full and production-filtered npm audits report zero advisories. Exact lock versions/integrities are committed; no audit warning was suppressed and no force-upgrade command was used.

## Complete critical/high inventory

| Package | Before severity | Vulnerable locked version(s) | Remediated version(s) | Ancestry, exposure and compatibility |
| --- | --- | --- | --- | --- |
| @prisma/config | high | 6.16.2 | 6.16.2 | Prisma CLI config loading; unchanged parent version with scoped dependency fixes |
| browserslist | high | 4.26.2 | 4.29.5 | Autoprefixer CSS build tooling; compatible-major transitive refresh |
| deepmerge-ts | high | 7.1.5 | 8.0.0 | Prisma config/c12 merge; scoped major override, exercised through actual config loader |
| defu | high | 6.1.4 | 6.1.7 | Prisma config -> c12/giget/rc9; compatible patch |
| effect | high | 3.16.12 | 3.20.0 | Prisma config/schema decoding; scoped compatible-major override |
| linkify-it | high | 5.0.0 | Removed | Resend -> mailparser; entire obsolete mailparser chain removed |
| mailparser | high | 3.9.1 | Removed | Resend runtime import chain; replaced by upstream Resend minor update |
| nanoid | high | 3.3.11 | 3.3.20 | PostCSS identifiers in CSS build tooling; retained major 3 |
| next | critical | 16.0.10 | 16.4.3 | Application runtime and build; direct dependency |
| nodemailer | high | 7.0.11 | Removed | Resend -> mailparser; entire obsolete chain removed |
| postcss | high | 8.5.13; Next nested 8.4.31 | 8.5.23, 8.5.32 | Next build/CSS runtime dependency plus dev PostCSS; compatible 8.x patches |
| prisma | high | 6.16.2 | 6.16.2 | Prisma CLI/build/migration tooling; inherited findings through config; CLI/client remain 6.16.2 |
| sharp | high | 0.34.4 | 0.35.5 | Next image optimization runtime; patched native library, SVG?AVIF exercised |
| source-map-js | high | 1.2.1 | 1.2.2 | PostCSS/Tailwind source-map build tooling; compatible patch |
| tar | critical | 7.5.7 | 7.5.22 | Tailwind oxide install/build tooling; development dependency |
| vite | high | 8.0.10 | 8.3.5 | Vitest dev transformation/server tooling; retained major 8 |
| zod | high | 4.1.11 | 4.6.6 | Direct request/payload validation runtime; retained major 4 |

PostCSS and its source-map/nanoid consumers are patched in both application/build and test trees. Next 16.4.3 exceeds the cited 16.4.1 minimum and its other currently affected ranges; sharp 0.35.5 addresses the image library chain. tar 7.5.22 exceeds both the cited critical minimum 7.5.19 and later high affected ranges. Authentication/session dependencies, React, Mercado Pago SDK and both Prisma CLI/client remain at their existing locked versions.

## Targeted updates and justified overrides

Direct updates: Next 16.0.10 -> 16.4.3; Resend 6.9.1 -> 6.12.3; Zod 4.1.11 -> 4.6.6; PostCSS 8.5.13 -> 8.5.23; Vitest 4.1.5 -> 4.1.12. Only named vulnerable transitive families and their required dependency closure were refreshed using npm. No blanket dependency update or major Prisma/Mercado Pago upgrade was performed.

Prisma 6.16.2 pins vulnerable deepmerge-ts 7.1.5 and Effect 3.16.12. A version-scoped @prisma/config@6.16.2 override selects deepmerge-ts 8.0.0 and Effect 3.20.0, preserving the current datasource/schema/client/engine architecture. Real Prisma config-loader, generation/validation, populated migration rehearsal, regression and build checks validate this exception. Review/remove these overrides when a future parent release supplies patched dependencies; do not assume they apply to a different Prisma version.

The remaining moderate uuid finding affected the existing Mercado Pago 2.9.0 dependency. Its actual SDK source consumes only CommonJS uuid.v4() for idempotency keys. A parent-scoped override selects uuid 11.1.1, which retains that API, without changing the SDK or payment logic. The real SDK idempotency function is exercised without any HTTP/payment request. Resend's compatible minor update removes the mailparser/nodemailer/linkify-it chain; its real send payload/response is tested against a mocked fetch with no delivery. Vitest/mocker, baseline-browser-mapping and svix moderate findings are also resolved.

The full before inventory with advisory titles, affected ranges and ancestry is preserved below. Package-level inherited findings for prisma, @prisma/config and mailparser disappear when their vulnerable children are fixed or removed; those parent versions are not misrepresented as independently patched releases.

## Validation and CI

A deterministic npm ci --ignore-scripts completed. npm ls exits 0 with no invalid/missing required dependency; on Windows it labels two locked optional Sharp WASM fallback entries extraneous because their FreeBSD/WebContainers parents are platform-filtered. They are present in the integrity-locked optional graph, not untracked dependency additions. They do not change the successful native image probe or clean audit.

Initial local MAIN validation: 594 passed, zero failed/skipped, including four new third-party compatibility checks. The first Linux push run exposed one intermittent final-seat rejection assertion; its exact transaction rejection was not recorded by the old object matcher. The test now prints the exact rejected code and exercises five independent concurrent schedules without weakening capacity/entitlement assertions. Both subsequent Linux push and PR runs passed 598 tests, zero failed/skipped, audit, typecheck, Prisma and build. No application logic was changed to obtain a passing result; the earlier intermittent failure remains disclosed as validation history, not claimed diagnosed. Prisma generate/validate, TypeScript --noEmit, all existing unit/PostgreSQL integration tests, populated historical migration/dump-restore rehearsal and Production build with synthetic fixture credentials passed. No mutating test was pointed at Production. Baseline 24 historical migration SQL files, schema and application src files are unchanged. Existing Monthly Unlimited, auth/session, packages, credits, bookings, payroll/accounting, Mercado Pago, TotalPass and inert Wellhub stub behavior remain protected by the existing full suite.

The monthly validation harness now verifies approved baseline ancestry rather than a branch-name list (supports detached CI), generates/validates Prisma and typechecks before tests, and supports an explicit --build phase. Its existing default test selection and migration manifest remain intact. The shared test:security:release entry point chooses the Wellhub harness only when that reviewed implementation is present, otherwise the MAIN harness; both create their own labeled disposable localhost PostgreSQL database and scrub inherited service/database configuration.

The new GitHub Actions workflow has contents:read permissions, full history for lineage checks, pinned action commits, Node 22, deterministic installation without lifecycle scripts, unsuppressed npm audit and the complete isolated regression/typecheck/Prisma/build command. It consumes no Production secrets or datasource. The latest published hotfix push and PR CI runs passed the complete pipeline; final commit status must be rechecked after any further edit. Local tests are recorded separately from remote CI.

vercel.json adds deploymentEnabled=false only for security/main-dependency-hardening and release/wellhub-production-security, preventing automatic Vercel deployments while these two branches are reviewed. MAIN remains unspecified/default-enabled; cron and other settings are unchanged. This is source-level review-branch protection, not a production provider setting/environment mutation. [Supported Vercel Git branch controls](https://vercel.com/docs/project-configuration/git-configuration).

## Separate release decisions

Security hotfix: technically validated locally, awaiting review/remote CI and separate Production promotion/deployment authorization. No database migration is needed. Reconfirm MAIN and Vercel project/source, merge only this tree through the reviewed repository method, monitor the single automatic MAIN deployment, verify exact final SHA/READY/www.wavestudio.mx, then non-destructively smoke existing public/authenticated flows and review errors. Preserve current environment values and existing webhook stub. Do not seed, migrate, activate Wellhub or send payments/bookings.

Application rollback target recorded by the readiness audit is dpl_HfbNBaCfbWLXxzXh6jfXvou1Zvpk, source MAIN 15915ddb4fc9453b671ba7772a2924acbfa91503. Reconfirm availability before any later authorized release. Rolling back would restore vulnerable dependency versions, so it is an emergency containment tradeoff requiring prompt follow-up, not a security fix. No database restoration is needed for this schema-neutral hotfix. Never select a pre-Monthly Unlimited deployment.

Wellhub feature release remains a separate decision: integrate this security correction into a new candidate while preserving the original 353dfa84f250af01374a585e17b963c9493ac933, retain/rehearse both approved additive migrations, independently validate the full feature tree, and close Production flag/mapping/off-host recovery gates before separately authorized migration/deployment. Activation is another explicit decision. Backup verification does not authorize a release.

## Maintainer advisories reviewed

- browserslist: [Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)
- browserslist: [Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats)](https://github.com/advisories/GHSA-73wf-gq98-2v4g)
- deepmerge-ts: [DeepmergeTS has stack exhaustion when merging recursive object graphs](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
- defu: [defu: Prototype pollution via `__proto__` key in defaults argument](https://github.com/advisories/GHSA-737v-mqg7-c878)
- effect: [Effect `AsyncLocalStorage` context lost/contaminated inside Effect fibers under concurrent load with RPC](https://github.com/advisories/GHSA-38f7-945m-qr2g)
- linkify-it: [LinkifyIt#match scan loop has quadratic algorithmic complexity](https://github.com/advisories/GHSA-22p9-wv53-3rq4)
- linkify-it: [linkify-it: Quadratic-complexity DoS via the `mailto:` validator scan-loop on attacker text](https://github.com/advisories/GHSA-v245-v573-v5vm)
- nanoid: [nanoid: non-secure generators can loop indefinitely with negative size](https://github.com/advisories/GHSA-28wg-ghj8-5hjv)
- nanoid: [nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
- nanoid: [nanoid: Integer Overflow or Wraparound](https://github.com/advisories/GHSA-xwg4-73v4-xw9w)
- next: [Next.js HTTP request deserialization can lead to DoS when using insecure React Server Components](https://github.com/advisories/GHSA-h25m-26qc-wcjf)
- next: [Next.js has a Denial of Service with Server Components](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3)
- next: [Next.js Vulnerable to Denial of Service with Server Components](https://github.com/advisories/GHSA-8h8q-6873-q5fj)
- next: [Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes - Incomplete Fix Follow-Up](https://github.com/advisories/GHSA-26hh-7cqf-hhc6)
- next: [Next.js vulnerable to Denial of Service via connection exhaustion in applications using Cache Components](https://github.com/advisories/GHSA-mg66-mrh9-m8jx)
- next: [Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades](https://github.com/advisories/GHSA-c4j6-fc7j-m34r)
- next: [Next.js has a Middleware / Proxy bypass through dynamic route parameter injection](https://github.com/advisories/GHSA-492v-c6pp-mqqv)
- next: [Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes](https://github.com/advisories/GHSA-267c-6grr-h53f)
- next: [Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n](https://github.com/advisories/GHSA-36qx-fr4f-26g5)
- next: [Next.js: Middleware / Proxy bypass in App Router applications using Turbopack and single locale](https://github.com/advisories/GHSA-6gpp-xcg3-4w24)
- next: [Next.js: Denial of Service in App Router using Server Actions](https://github.com/advisories/GHSA-m99w-x7hq-7vfj)
- next: [Next.js: Server-Side Request Forgery in Server Actions on custom servers](https://github.com/advisories/GHSA-89xv-2m56-2m9x)
- next: [Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)
- next: [Next.js: Unauthenticated Remote Code Execution on windows-hosted servers](https://github.com/advisories/GHSA-p293-qw3h-jr36)
- next: [Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)
- next: [Next.js has Server-Side Request Forgery in Image Optimization](https://github.com/advisories/GHSA-cjq9-62q9-8jv4)
- next: [Next.js: Unauthenticated Remote Code Execution in Image Optimization API when SVG files are used](https://github.com/advisories/GHSA-2464-fhr4-w9xw)
- next: [Next.js: Denial of Service in App Router using Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)
- next: [Next.js: Unauthenticated Remote Code Execution in `use cache` functions returning typed arrays](https://github.com/advisories/GHSA-673q-mjm6-r5xr)
- nodemailer: [Nodemailer: Message-level raw option bypasses disableFileAccess/disableUrlAccess, enabling arbitrary file read and full-response SSRF in the delivered message](https://github.com/advisories/GHSA-p6gq-j5cr-w38f)
- nodemailer: [Nodemailer: Quadratic (O(n²)) time complexity in addressparser allows remote denial of service via a crafted address list](https://github.com/advisories/GHSA-2x7j-588g-ccc2)
- nodemailer: [Nodemailer: Quadratic backtracking in the addressparser free-text fallback allows remote denial of service](https://github.com/advisories/GHSA-v53p-9fqp-m79j)
- nodemailer: [Nodemailer: Improper TLS Certificate Validation in OAuth2 Token Fetch Enables Credential Interception](https://github.com/advisories/GHSA-r7g4-qg5f-qqm2)
- postcss: [PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments](https://github.com/advisories/GHSA-6g55-p6wh-862q)
- postcss: [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849)
- sharp: [sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591](https://github.com/advisories/GHSA-f88m-g3jw-g9cj)
- sharp: [sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
- sharp: [sharp : Vulnerability in librsvg dependency CVE-2026-96889](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- source-map-js: [source-map-js allows event-loop denial of service through indexed source-map section offsets](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- tar: [Arbitrary File Read/Write via Hardlink Target Escape Through Symlink Chain in node-tar Extraction](https://github.com/advisories/GHSA-83g3-92jg-28cx)
- tar: [tar has Hardlink Path Traversal via Drive-Relative Linkpath](https://github.com/advisories/GHSA-qffp-2rhf-9h96)
- tar: [node-tar Symlink Path Traversal via Drive-Relative Linkpath](https://github.com/advisories/GHSA-9ppj-qmqm-q256)
- tar: [node-tar: Decompression/parse DoS via unlimited input](https://github.com/advisories/GHSA-23hp-3jrh-7fpw)
- tar: [node-tar: Negative tar entry size causes infinite loop in archive replace](https://github.com/advisories/GHSA-8x88-c5mf-7j5w)
- tar: [node-tar: Uncontrolled recursion in mapHas/filesFilter allows uncatchable stack-overflow DoS via crafted long-path tar with member selection](https://github.com/advisories/GHSA-r292-9mhp-454m)
- vite: [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
- vite: [launch-editor: `fs.existsSync()` existence check can be bypassed on Windows](https://github.com/advisories/GHSA-587h-7wmj-h5pm)
- zod: [Zod can exhaust memory while validating oversized constrained collections](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
