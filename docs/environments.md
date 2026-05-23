# Environments

This repository is prepared for three isolated deployment environments. Production is already running on Vercel and already has Production environment variables configured. Do not modify Production variables while setting up UAT or dev.

## Intended Setup

### Production

- Vercel environment: Production
- Branch: main
- Neon database: wave-prod
- Status: already configured
- Do not touch unless intentionally deploying production.

### UAT

- Vercel custom environment: uat
- Branch: uat
- Neon database: wave-uat
- Use its own DATABASE_URL and DIRECT_URL or DATABASE_URL_UNPOOLED.

### Dev

- Vercel custom environment: dev
- Branch: dev
- Neon database: wave-dev
- Use its own DATABASE_URL and DIRECT_URL or DATABASE_URL_UNPOOLED.

Never reuse production DATABASE_URL in uat or dev.

## Environment Variables

Required server-only variables:

- DATABASE_URL
- JWT_SECRET
- APP_BASE_URL
- RESEND_API_KEY
- MP_ACCESS_TOKEN
- MP_WEBHOOK_SECRET
- CRON_SECRET

Optional server-only variables:

- DIRECT_URL
- DATABASE_URL_UNPOOLED
- UPSTASH_REDIS_REST_URL
- UPSTASH_REDIS_REST_TOKEN
- ALLOW_SANDBOX
- CLEAN_NEXT_FULL

No NEXT_PUBLIC variables are currently required.

Prisma currently uses `env("DATABASE_URL")` in `prisma/schema.prisma`. The schema does not currently use `directUrl`, so DIRECT_URL and DATABASE_URL_UNPOOLED are documented placeholders for Neon direct/unpooled connections if your migration workflow needs them.

## Manual Vercel Checklist

1. Create Neon project/database wave-uat.
2. Create Neon project/database wave-dev.
3. In Vercel, create custom environment "uat".
4. Set branch tracking: uat -> uat.
5. Add UAT env vars by copying the keys from Production, but replacing values that must differ:
   - DATABASE_URL
   - DIRECT_URL or DATABASE_URL_UNPOOLED
   - APP_BASE_URL, AUTH URL, or NEXTAUTH_URL if used
   - webhook URLs if needed
6. In Vercel, create custom environment "dev".
7. Set branch tracking: dev -> dev.
8. Add Dev env vars by copying the keys from Production, but replacing values that must differ.
9. Assign domains:
   - production domain -> Production/main
   - uat domain -> uat environment
   - dev domain -> dev environment
10. Deploy dev first, then uat, then production only after verification.

## Safe Commands

- `npm run env:check` prints only environment name, NODE_ENV, required-key presence, and redacted database host/name.
- `npm run db:validate` validates the Prisma schema without mutating data.
- `npm run db:generate` regenerates the Prisma client without mutating data.
- `npm run db:migrate:deploy` applies committed migrations to whichever database is in the current environment. Run it only when you intentionally want to migrate that selected environment.

Do not run `prisma migrate reset` or `prisma db push` against production.
