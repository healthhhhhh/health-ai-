# HealthMate — your AI health companion

HealthMate helps people understand health information, track their health, make sense of medical
reports and keep up with clinician-provided instructions, with an AI Health Assistant.
**It is not a doctor and does not diagnose.**

Monorepo: native iOS app (Swift/SwiftUI), web app (Next.js) and a NestJS API backed by Supabase
(Postgres + Auth + Storage + pgvector) and Redis. See [`docs/architecture.md`](docs/architecture.md),
[`docs/backend-supabase-migration.md`](docs/backend-supabase-migration.md),
[`docs/design-system.md`](docs/design-system.md), [`docs/roadmap.md`](docs/roadmap.md) and the rules
in [`CLAUDE.md`](CLAUDE.md).

## Quick start (no accounts needed)

```bash
npm install
npm run build -w @healthmate/safety && npm run build -w @healthmate/api
npm run demo -w @healthmate/api     # API on :4000 with an embedded database and a scripted, labelled demo AI
npm run dev                         # web on http://localhost:3000 — sign in as demo@healthmate.example / demo-password-123
```

Without any configuration the API uses an embedded PostgreSQL (PGlite with pgvector), local file
storage, local accounts and in-process jobs.

## Set up with Supabase

1. **Create a project** at [supabase.com](https://supabase.com) (choose the region your users are in).
   Under *Authentication → URL Configuration* add `https://<your web domain>/reset-password` to the
   redirect URLs; for production turn on email confirmation and configure custom SMTP.
2. **Environment**: `cp .env.example .env` and fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` (*Project Settings → API Keys*), `DATABASE_URL` (*Connect → Transaction
   pooler*), `ANTHROPIC_API_KEY`, `REDIS_URL` and `EMBED_FUNCTION_SECRET` (any random string of 24+
   characters). **Never commit `.env`**; the secret key and AI key are server-only.
3. **Migrations** (tables, RLS policies, private buckets):
   ```bash
   npx supabase login && npx supabase link --project-ref <project-ref>
   npx supabase db push                        # applies supabase/migrations
   # or, with DATABASE_URL set: npm run build -w @healthmate/api && npm run db:migrate -w @healthmate/api
   ```
4. **Embeddings function** (semantic health memory):
   ```bash
   npx supabase secrets set EMBED_FUNCTION_SECRET=<same value as in .env>
   npx supabase functions deploy embed --no-verify-jwt
   ```
5. **Seed**: there is no health seed data by design (HealthMate never invents medical history).
   Create an account in the app. `supabase/seed.sql` is used only by the local stack.
6. **Run the API** (and the worker when using Redis):
   ```bash
   npm run build -w @healthmate/safety && npm run build -w @healthmate/api
   npm run start -w @healthmate/api            # reads ../../.env
   npm run worker -w @healthmate/api           # report/photo analysis, embeddings, housekeeping
   ```
7. **Web**: `cp apps/web/.env.example apps/web/.env.local` (`HEALTHMATE_API_URL=http://localhost:4000/v1`),
   then `npm run dev`.
8. **iOS** (macOS + Xcode 16, iOS 17+):
   ```bash
   brew install xcodegen
   cd apps/ios && xcodegen generate && open HealthMate.xcodeproj
   ```
   Debug builds use `http://localhost:4000/v1`; set `HM_API_BASE_URL` in `apps/ios/project.yml` for release builds. See
   [`apps/ios/README.md`](apps/ios/README.md).

### Local Supabase (Docker)

```bash
npx supabase start          # Postgres, Auth, Storage, Data API, Edge Runtime; applies migrations
npx supabase status         # URLs and local keys
```

## Tests

```bash
npm test                    # tokens, safety rules, migrations mirror, web + API unit tests (PGlite)
npm run typecheck && npm run lint
npm run build && npm run test:e2e        # Playwright: desktop, tablet, phone + axe accessibility
cd apps/ios/Packages/HealthMateCore && swift test

# API against real Supabase + Redis (what CI runs after `supabase start`):
REDIS_URL=redis://127.0.0.1:6379 TEST_DATABASE_URL=<DB_URL> \
SUPABASE_LIVE_TEST=1 SUPABASE_URL=<API_URL> SUPABASE_PUBLISHABLE_KEY=<publishable> SUPABASE_SECRET_KEY=<secret> \
SUPABASE_MAILPIT_URL=<MAILPIT_URL> npm test -w @healthmate/api -- --no-file-parallelism
```

`SUPABASE_LIVE_TEST=1` creates and then deletes test users; against a hosted project, use a
staging project.

## Design tokens
Edit `packages/design-tokens/tokens.json`, then `npm run tokens` to regenerate web CSS and Swift.
