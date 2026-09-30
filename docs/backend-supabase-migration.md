# Backend migration to Supabase

Status: **implemented and verified against a local Supabase stack** (`supabase start`: Postgres 17,
GoTrue, Storage API, PostgREST, Edge Runtime) and Redis. Verification against the hosted project
`gkyxuygccchxbhgqhefx` is pending network access from the build environment (see §12).

```
iOS app ─┐                                   ┌─ Supabase Postgres (tables, RLS, pgvector, migrations)
         ├─ HTTPS ─▶ NestJS API (services/api) ┼─ Supabase Auth (sign-up, sessions, reset, JWKS)
Web app ─┘  (session only; no keys)   │        ├─ Supabase Storage (private buckets, signed URLs)
                                      │        └─ Edge Function `embed` (gte-small, 384-d)
                                      ├─ AI Gateway ─▶ Anthropic (server-side key only)
                                      └─ Redis ─ rate limits + BullMQ ─▶ worker (npm run worker)
```

Clients never receive the Supabase secret key, the database URL or any AI provider key. The web
app talks only to its own Next.js server, which calls the API with the person's session.

## 1. Current architecture (before this migration)

- NestJS 11 API in `services/api`, one process, modules per feature (auth, profile, chat, memory,
  documents, health-data, timeline, check-ins, plan, account).
- Data access through a small `Database` interface (parameterised SQL) over `pg` or embedded PGlite.
- Everything user-scoped by `user_id` in the API layer; no database-level isolation.
- Background work (report/photo analysis) in an in-process queue; rate limits in memory.
- Full audit: [`production-architecture-audit.md`](production-architecture-audit.md).

## 2. Current database schema (before)

Migrations `0001`–`0003`: `users` (email + argon2id hash), `refresh_tokens`, `profiles`,
`health_conditions`, `allergies`, `medications`, `health_memories` (full-text search, no vectors),
`conversations`, `messages`, `documents` (one table for reports and photos, AI result as JSON),
`health_measurements`, `timeline_events`, `consents`, `safety_events`, `ai_usage`, `audit_logs`,
`mood_checkins`, `plans` (whole plan as one JSON document with a revision).

## 3. Current authentication (before)

Own accounts: argon2id passwords, 15-minute HS256 access tokens, rotating refresh tokens with
reuse detection (`refresh_tokens`), logout revokes the family. No password reset, no email
verification.

## 4. Current storage (before)

`LocalObjectStorage`: files on the API server's disk, uploads and downloads via HMAC-signed,
expiring `/v1/uploads/:token` URLs. Single-server only.

## 5. API endpoints (contract unchanged; additions marked ➕)

Every route below requires a valid session except `auth/*` and the signed `uploads/:token`
links, and every route is rate-limited (per user, or per hashed IP when signed out; a default
limit applies to any route without its own — enforced by a test that inspects every controller).

| Group | Routes |
|---|---|
| Auth | `POST /v1/auth/register` (201 session, or ➕ 202 `{confirmationRequired}`), `login`, `refresh`, `logout`, ➕ `password-reset`, ➕ `password-reset/complete` |
| Profile, conditions, allergies, medications | `GET /v1/me`, `PATCH /v1/me/profile`, `POST/DELETE /v1/me/conditions`, `POST/DELETE /v1/me/allergies`, `POST/PATCH/DELETE /v1/me/medications` |
| Consents, export, deletion | `GET/POST /v1/me/consents`, `GET /v1/me/export`, `POST /v1/me/delete` |
| ➕ Symptoms | `GET/POST /v1/symptoms`, `PATCH/DELETE /v1/symptoms/:id`, `GET/POST /v1/symptoms/:id/events` |
| Measurements, health data | `POST /v1/health-data/measurements`, `GET /v1/health-data/trends`, `GET /v1/health-data/latest`, `DELETE /v1/health-data/apple-health` |
| ➕ HealthKit | `GET/PUT/DELETE /v1/healthkit/connection` |
| Chat | `GET/POST /v1/conversations`, `GET/DELETE /v1/conversations/:id`, `POST /v1/conversations/:id/messages` |
| Memory | `GET/POST /v1/memories`, `PATCH/DELETE /v1/memories/:id` |
| Documents and images | `POST /v1/documents`, `POST /v1/documents/:id/process`, `GET /v1/documents[/:id]`, ➕ `GET /v1/documents/:id/file`, `DELETE /v1/documents/:id`, `PUT/GET /v1/uploads/:token` (local storage only) |
| Plans, tasks | `GET/PUT /v1/plan` (revisioned; tasks, medications, habits and completions) |
| ➕ Reminders | `GET /v1/reminders` |
| Timeline | `GET/POST /v1/timeline`, `DELETE /v1/timeline/:id` |
| Mood | `POST /v1/check-ins/mood`, `GET /v1/check-ins/mood/latest` |
| ➕ Care | `GET/POST /v1/care/providers`, `DELETE /v1/care/providers/:id`, `GET/POST /v1/care/appointments`, `PATCH/DELETE /v1/care/appointments/:id` |

## 6. Current persistence

PostgreSQL through `DATABASE_URL`, or PGlite (embedded, in-memory or `PGLITE_DIR`) when unset.
Migrations are plain SQL in `services/api/migrations`, applied once each by the API's runner.

## 7. In-memory / PGlite data

Kept, on purpose: development and the test suite run on PGlite **with pgvector** and local
stand-ins for Supabase's `auth` and `storage` schemas and roles
(`services/api/sql/supabase-compat.sql`, applied only when there is no real `auth` schema), so
the **same migrations and RLS policies** are exercised without Docker. In-process jobs and memory
rate limits remain the defaults when `REDIS_URL` is unset.

## 8. Supabase architecture (implemented)

- **Database**: `services/api/migrations` is the single source; `npm run supabase:migrations`
  mirrors it to `supabase/migrations` (checked in `npm test`). Apply with `supabase db push` or
  `npm run db:migrate -w @healthmate/api`; the runner recognises migrations the CLI already applied.
- **Auth** (`SupabaseIdentityProvider`): the API calls Supabase Auth server-side, so clients keep
  the same `/v1/auth/*` contract. Access tokens are verified locally with the project's JWKS
  (issuer, audience `authenticated`, role, expiry); legacy HS256 projects via `SUPABASE_JWT_SECRET`.
  `auth.users` triggers create/delete/sync `public.users` + `profiles` (same id), so existing
  foreign keys are untouched. Password reset: email link → web `/reset-password` → API completes
  it and signs out every session. Account deletion uses the admin API (secret key).
- **Storage** (`SupabaseObjectStorage`): private buckets `medical-reports` (PDF/JPEG/PNG, 20 MB),
  `health-images` (JPEG/PNG, 20 MB), `avatars` (5 MB). Objects live at `<user id>/<record id>`
  (a server-generated name; the original filename is only metadata). Uploads and downloads use
  signed URLs issued after the API's ownership check; the API re-checks exact size and the file's
  real type (magic bytes) before analysis. Metadata in `medical_documents` / `health_images`.
- **pgvector**: `health_memories.embedding vector(384)` + HNSW (cosine). Embeddings come from the
  `embed` Edge Function (Supabase's gte-small, in the same project — health text doesn't leave
  Supabase), called with the secret key + `EMBED_FUNCTION_SECRET`, in a background job.
  Retrieval = user-scoped nearest neighbours (distance < 0.6) ∪ full-text ∪ recent confirmed
  facts. **Similarity only selects context**: each fact goes to the model with its provenance
  (`ai_inferred` is labelled "unconfirmed"); it is never treated as evidence.
- **Provenance**: `user_reported`, `document_extracted`, `clinician_provided`, `healthkit`,
  `ai_inferred`, `user_confirmed`, `superseded`. A database trigger refuses promotion to
  `user_confirmed` without a new `confirmed_at` (set only by an explicit confirmation), and RLS
  forbids creating `ai_inferred` rows from a user session.
- **AI Gateway** unchanged: auth → deterministic triage (emergencies get fixed guidance, no AI
  call) → consent → context → model → schema + safety review → fallback on unsafe output.
- **Redis**: `RedisRateLimitStore` (atomic fixed window, fails open so an outage can't lock people
  out of their data) and `BullJobQueue` (`process-document`, `embed-memory`, retries with
  exponential backoff, ids-only payloads). `npm run worker` runs jobs plus housekeeping (stuck
  uploads, interrupted deletions).
- **Export / deletion**: export covers every table; deletion marks the account, deletes Storage
  objects, then the Auth identity (cascading every row), is idempotent, and a sweeper finishes any
  deletion interrupted part-way.

## 9. Migration mapping

| Before | After |
|---|---|
| `users.password_hash` (required) | nullable; `auth_provider` `local`/`supabase`; Supabase users created by trigger from `auth.users` |
| `refresh_tokens` | used only by local auth; Supabase sessions live in Supabase Auth |
| `documents` | split into `medical_documents` + `document_analysis` + `document_extractions` (+ `document_pages`) and `health_images` + `image_analysis`; data copied, old table kept as `documents_legacy` |
| `documents.storage_key` | `storage_bucket` + `storage_path` (`<user>/<id>`, enforced by a check) |
| `plans.document` JSON | `plan_items`, `task_completions`, `reminders` (`tasks` view = task items); `plans` keeps the revision |
| memory status `wearable` | `healthkit` (clients still accept the old value) |
| — | new: `symptoms`, `symptom_events`, `healthkit_connections` (+ `healthkit_measurements` view), `care_providers`, `appointments` (soft delete), `message_attachments` |
| local disk files | Supabase Storage, same `<user>/<id>` layout (copy with the Storage API if migrating a live server) |

## 10. Security / RLS plan (implemented, tested)

- RLS enabled on **every** table in `public` (a test fails if any isn't). `anon` has no access.
- Owner policies `(SELECT auth.uid()) = user_id`: full CRUD on self-entered records (conditions,
  allergies, medications, symptoms, care); read-only on server-derived data (messages, documents,
  analyses, plan tables); custom rules for memories (see §8) and timeline (only own
  `user_entered` entries).
- Server-only tables (RLS, no policies): `refresh_tokens`, `ai_usage`, `safety_events`,
  `audit_logs`, `documents_legacy`, `schema_migrations`.
- Storage: people read only their own folder; medical files can't be written directly (signed URLs
  only); avatars in own folder only.
- Functions pin `search_path`; `SECURITY DEFINER` trigger functions aren't executable by API roles;
  views are `security_invoker`. These are checked by tests (`test/rls.test.ts`).
- The API connects as a privileged role and still filters every query by the session's user; RLS is
  the independent guarantee (e.g. against the Data API with a stolen publishable key).
- Tests: `rls.test.ts` (User A vs User B read/update/delete/insert, memory provenance, timeline,
  Storage objects, constraints, indexes), `supabase-live.test.ts` (the same through real PostgREST
  and Storage), `records.test.ts` / `plan.test.ts` (API-level isolation, including client-supplied
  plan item ids that belong to someone else).

## 10a. Phase 2A additions

Migration `0008_health_record_foundation.sql` and the routes that used to exist only in Preview
mode — see [`phase2-plan.md`](phase2-plan.md) (what changed and why) and
[`health-memory-architecture.md`](health-memory-architecture.md) (provenance, time, retention):

| Group | Routes |
|---|---|
| Account | `GET /v1/me/account`, `POST /v1/me/onboarding`, `GET/PUT /v1/me/notification-preferences`, `PATCH /v1/me/profile` (+ `goals`, `unitSystem`) |
| Auth | `POST /v1/auth/change-password` (signed in), `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification`, `POST /v1/auth/oauth` (501 until 2C) |
| Record corrections | `PATCH /v1/me/conditions/:id`, `PATCH /v1/me/allergies/:id`, `PATCH /v1/me/medications/:id` (+ `startedOn`, `stoppedOn`) |
| Memory | `POST /v1/memories/:id/supersede`; `occurredOn`, `endedOn`, `category` on create/edit |
| Timeline, chat, care | `GET/PATCH /v1/timeline/:id`, `PATCH /v1/conversations/:id`, `GET/PATCH /v1/care/providers/:id`, `GET /v1/care/appointments/:id`, `PATCH /v1/care/appointments/:id` (any field) |
| Notifications | `GET /v1/notifications`, `POST /v1/notifications/read-all`, `PATCH/DELETE /v1/notifications/:id` |
| Treatment plans | `GET/POST /v1/treatment-plans`, `GET/PATCH/DELETE /v1/treatment-plans/:id` |

New tables `notification_preferences`, `notifications` (server-written), `treatment_plans`; views
`current_medications`, `current_conditions`, `current_allergies`; all under RLS (tested in
`test/rls.test.ts`). Export format is now `healthmate-export-v2`.

## 10b. Phase 2B additions

Migration `0009_daily_health_records.sql` — see [`phase2b-plan.md`](phase2b-plan.md):

| Group | Routes |
|---|---|
| Daily records | `PUT /v1/health-data/daily` (Apple Health days from the iPhone; newest computation wins), `GET /v1/health-data/daily?from&to&kinds` |
| Sync runs | `POST /v1/healthkit/sync-runs`, `PATCH /v1/healthkit/sync-runs/:id` (counts and error codes only) |
| Changed | `trends` / `latest` read daily records (Apple Health preferred); `POST measurements` refuses raw Apple Health samples (double-count risk) but still accepts whole days from older apps; `GET/PUT /v1/healthkit/connection` carry history-import status |

New tables `daily_health_records`, `health_sync_runs` (owner read-only under RLS; the API writes),
view `daily_health_summary`. Export includes both.

## 11. Environment variables

See [`.env.example`](../.env.example). Server-only: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `DATABASE_URL` (+ `DATABASE_CA_CERT`), `ANTHROPIC_API_KEY`, `REDIS_URL`,
`EMBED_FUNCTION_SECRET`, `PASSWORD_RESET_REDIRECT_URL`, `JWT_SECRET` (local auth only),
`SENTRY_DSN`, `AUDIT_LOG_RETENTION_DAYS`, `AI_USAGE_RETENTION_DAYS`, `SAFETY_EVENT_RETENTION_DAYS`. Production refuses to start without `DATABASE_URL` and Supabase Storage, and refuses
the development embedding provider.

## 12. Risks

- **Not yet run against the hosted project** — the build environment can't reach
  `*.supabase.co`. Everything was verified on the same stack locally; repeat with
  `SUPABASE_LIVE_TEST=1` (README) once reachable.
- **Secret key exposure**: the `sb_secret_…` key was shared in a chat. Rotate it in the dashboard
  (API Keys → secret keys) before production use.
- **Email**: Supabase's built-in email sender is rate-limited; configure custom SMTP and turn on
  email confirmation for production.
- **Pooler**: use the transaction pooler (6543) for the API; the runner's migrations run in one
  transaction per file, which works through it, but `supabase db push` uses a direct connection.
- **Embeddings**: gte-small is English-centric; retrieval falls back to full-text when the
  function is unavailable.
- **Health data regulations** (HIPAA/GDPR): requires Supabase's HIPAA add-on/BAA or equivalent,
  region choice, and a DPA — a business and legal decision.
- **Malware scanning** of uploads is not implemented (files are type-checked and never executed).

## 13. Rollback plan

- Adapters are chosen by configuration, so rollback is a config change: unset `SUPABASE_URL`
  (or set `AUTH_PROVIDER=local`, `STORAGE_PROVIDER=local`) and point `DATABASE_URL` at the
  previous Postgres. Unset `REDIS_URL` to return to in-process jobs and limits.
- Migrations are additive: old data was copied, not dropped (`documents_legacy`, `plans.document`
  kept nullable). Take a `pg_dump` before applying `0004`–`0007` in production; restore it to roll
  back the schema.
- People created in Supabase Auth have no local password: switching back to local auth requires a
  password reset for them (local reset isn't implemented) — decide before cut-over.
- Storage objects keep the `<user>/<id>` layout in both adapters, so files can be copied either
  way with the Storage API.
