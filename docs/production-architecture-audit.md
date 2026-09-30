# Production architecture audit: Supabase + Redis

Status: **analysis only**. Nothing described under *Target state* or *Migration plan* is implemented yet.
Audited: `services/api` at the commit that adds this file.

Planned production stack: **Supabase** (PostgreSQL, Auth, Storage, pgvector) and **Redis** (rate limiting, background jobs, queues).

---

## 1. Current state

### 1.1 Database

| Aspect | Today |
|---|---|
| Access layer | `src/db/database.ts` — a thin `Database` interface (`query`, `transaction`, `exec`, `close`). Plain parameterised SQL, no ORM. |
| Engines | `PgDatabase` (node-postgres `Pool`) when `DATABASE_URL` is set; otherwise `PgliteDatabase` (embedded Postgres in WASM). **PGlite is in-memory unless `PGLITE_DIR` is set.** Production refuses to start without `DATABASE_URL` (`config.ts`). |
| Migrations | Custom runner (`migrate()`), SQL files in `services/api/migrations`, tracked in `schema_migrations`. Applied at start-up. |
| Authorization | In the application: every query filters by the authenticated `user_id`. **No row-level security.** |
| Search | Postgres full text (`tsvector` generated column + GIN) on `health_memories`. No vectors. |

**Tables (18, plus `schema_migrations`)**

| Table | Purpose | Notes |
|---|---|---|
| `users` | Account: email, argon2id `password_hash` | Own auth (see 1.2) |
| `refresh_tokens` | Hashed opaque refresh tokens, `family_id`, expiry, revocation | Own auth |
| `profiles` | Name, date of birth, sex, height, time zone | 1:1 with user |
| `health_conditions` | Condition name, status, source, notes | `source` ∈ user_reported / clinician_provided / document_extracted |
| `allergies` | Substance, reaction, severity, source | |
| `medications` | Name, **verbatim instruction**, source, active | Instruction never rewritten |
| `health_memories` | Fact, source, status (`ai_inferred` ≠ `user_confirmed`), confidence, `search tsvector` | API only accepts `user_reported`/`user_confirmed` |
| `conversations` | Chat threads | |
| `messages` | User/assistant turns, `structured jsonb` (answer or escalation), `triage_level` | |
| `documents` | Report/photo metadata, `storage_key`, status, AI `result jsonb`, model | Files live in object storage |
| `health_measurements` | Kind, value, unit, time, source, `external_id` (unique per user, partial index) | Apple Health sync |
| `timeline_events` | Event type, title, time, `source_type`, `payload jsonb` | |
| `consents` | Append-only consent history (kind, granted, version) | |
| `mood_checkins` | Mood + time | Added in 0002 |
| `plans` | One JSONB document per user (items + completions) with `revision` | Added in 0003; shared by iOS and web |
| `ai_usage` | Feature, model, token counts, outcome | No content |
| `safety_events` | Triage level, matched rule ids, channel | No content |
| `audit_logs` | Action + metadata | Never health content |

### 1.2 Authentication

- **Own implementation** (`src/modules/auth`):
  - Passwords are hashed with argon2id (`@node-rs/argon2`, OWASP parameters), and login uses a dummy-hash timing equaliser.
- **Access tokens:**
  - HS256 JWTs (`jose`) lasting **15 minutes**, with an issuer and audience, signed with `JWT_SECRET`.
  - In development the secret is random per process, so sessions reset on restart.
- **Refresh tokens:**
  - Opaque random tokens, stored as SHA-256 hashes, lasting 30 days.
  - They **rotate on every use**. Reusing one revokes its whole family.
  - Logout revokes the token; account deletion revokes all of them.
- **Guard** (`common/auth.ts`): verifies the JWT signature, issuer, audience and expiry only, with **no database check**. An access token therefore stays usable for up to 15 minutes after logout or account deletion.
- **Clients:**
  - iOS keeps tokens in the Keychain (`KeychainTokenStore`) and refreshes them single-flight in `APIClient`.
  - The web app keeps tokens in **httpOnly cookies** set by the Next.js server; `src/proxy.ts` refreshes them, and browser JavaScript never sees them.
- **Missing:** email verification, password reset, multi-factor authentication, Sign in with Apple, account lockout beyond rate limits.

### 1.3 Storage

- **Interface:** `ObjectStorage` (`createUploadUrl`, `read`, `delete`) in `src/modules/documents/storage.ts`.
- **Only implementation:** `LocalObjectStorage`.
  - Files live on the local disk (`STORAGE_DIR`, default `.data/uploads`), mode 0600.
  - Upload URLs point at `PUT /v1/uploads/:token`. The token is an HMAC-signed grant for **one key, content type and size**, valid for 15 minutes.
- **Object key:** `{user_id}/{document_id}`.
- **At processing time** the file's magic bytes are checked (PDF, JPEG, PNG) against the declared type.
- **Deletion:** files are deleted with the document and on account deletion.
- **Production gaps:** a local disk isn't shared between instances or durable, and there's no malware scanning.

### 1.4 AI provider

- **Gateway:** `AiGateway` sits over the `AiProvider` interface and records usage (tokens and outcome) in `ai_usage`. It maps failures to `ai_unavailable`, `ai_declined` or `ai_invalid_output`.
- **Providers:**
  - `AnthropicProvider`: Anthropic SDK beta Messages API, model `AI_MODEL` (default `claude-opus-5-5`), `fallbacks: "default"`, and structured output through `output_config.format` with a JSON schema generated from zod. Reports are sent as base64 PDFs, photos as base64 images.
  - `UnavailableProvider`: used when there's no key.
  - `DemoAiProvider`: scripted answers, labelled as a demo.
  - `FakeAiProvider`: used in tests.
- **Features:** `chat`, `document_extraction` and `image_analysis`.
- **Safety** (`@healthmate/safety`) wraps every call:
  - deterministic triage runs before the model, and emergencies never reach it
  - answers are reviewed afterwards and regenerated or replaced when unsafe
  - prompt-injection flags are applied to uploaded content
- **No embeddings** are generated anywhere.

### 1.5 Rate limiting and background jobs

| | Today | Limitation |
|---|---|---|
| Rate limiting | `RateLimiter` + `RateLimitGuard` (`common/rate-limit.ts`): **in-memory fixed window**, keyed by user id or a hashed IP address | Per process: limits multiply with instance count and reset on restart |
| Buckets | auth-register 5/min · auth-login 10/min · auth-refresh 30/min · chat 20/min · documents-create 20/h · documents-process 20/h · health-ingest 60/h · export 5/h · delete 5/h | |
| Background jobs | `JobQueue` (`documents/job-queue.ts`): **in-process**, concurrency 2, drained on graceful shutdown | Jobs are lost on a crash or deploy; a document can stay `processing` forever; no retries or dead-letter queue; can't scale workers separately |

### 1.6 API endpoints (45)

| Group | Endpoints |
|---|---|
| Health | `GET /health`, `GET /v1/meta` (AI availability, demo flag) |
| Auth | `POST /v1/auth/register`, `/login`, `/refresh`, `/logout` |
| Profile | `GET /v1/me`, `PATCH /v1/me/profile`, `POST` + `DELETE /v1/me/conditions[/:id]`, `POST` + `DELETE /v1/me/allergies[/:id]`, `POST` + `PATCH` + `DELETE /v1/me/medications[/:id]` |
| Account | `GET /v1/me/export`, `POST /v1/me/delete` (needs the password), `GET` + `POST /v1/me/consents` |
| Chat | `GET` + `POST /v1/conversations`, `GET` + `DELETE /v1/conversations/:id`, `POST /v1/conversations/:id/messages` |
| Memory | `GET /v1/memories?q=`, `POST /v1/memories`, `PATCH` + `DELETE /v1/memories/:id` |
| Documents | `POST /v1/documents`, `POST /v1/documents/:id/process`, `GET /v1/documents[/:id]`, `DELETE /v1/documents/:id`, `PUT /v1/uploads/:token` |
| Health data | `POST /v1/health-data/measurements`, `GET /v1/health-data/trends`, `GET /v1/health-data/latest`, `DELETE /v1/health-data/apple-health` |
| Timeline | `GET` + `POST /v1/timeline`, `DELETE /v1/timeline/:id` |
| Check-ins | `POST /v1/check-ins/mood`, `GET /v1/check-ins/mood/latest` |
| Plan | `GET` + `PUT /v1/plan` (checked against a revision; 409 `plan_conflict`) |

Consent is enforced server-side:
- `ai_processing` for chat
- `document_processing` for documents
- `health_data_sync` for Apple Health ingest

### 1.7 What is persisted where

| Data | Where today |
|---|---|
| All domain data (profile, chat, memory, documents, measurements, timeline, consents, plan, mood, usage and safety events, audit) | PostgreSQL through `DATABASE_URL`. **In development, tests and demo: PGlite, in memory unless `PGLITE_DIR` is set.** |
| Uploaded files | Local disk (`STORAGE_DIR`) |
| Rate-limit windows | In process memory |
| Background jobs | In process memory |
| JWT signing secret | `JWT_SECRET`; random per process in development |
| iOS device | Plan (file, synced to `/v1/plan`), mood (UserDefaults, synced), tokens (Keychain), Apple Health (read on device; synced only with consent) |
| Web browser | Session cookies only |

---

## 2. Target state

### 2.1 Supabase PostgreSQL: what maps directly

**Everything maps.** The schema uses only standard PostgreSQL:
- uuid, `gen_random_uuid()`, jsonb and `text[]`
- a generated `tsvector` column with a GIN index
- a partial unique index
- `ON CONFLICT … WHERE`

`PgDatabase` works against Supabase unchanged.

Changes needed:
- **User identity moves to `auth.users`**:
  - Drop `users` and `refresh_tokens`.
  - Repoint every `user_id` foreign key to `auth.users(id) ON DELETE CASCADE`.
  - `profiles.user_id` becomes the 1:1 row for `auth.users`, created by a trigger on sign-up.
- **Connection:**
  - Use the **Supavisor pooler** (transaction mode, port 6543) for the API. node-postgres sends unnamed prepared statements, which transaction mode supports.
  - Keep the direct connection (port 5432) for migrations.
- **Migrations:** move to `supabase/migrations` (Supabase CLI) so local, staging and production share one history, and retire the custom runner. PGlite stays for fast unit tests only.
- **Account deletion:** delete the Storage objects, then call `auth.admin.deleteUser(id)`. The cascade removes every row.

### 2.2 Supabase Auth vs the existing auth code

| Capability | Use |
|---|---|
| Sign-up, sign-in, refresh, logout, password reset, email verification, MFA, Sign in with Apple | **Supabase Auth.** Delete `modules/auth` (argon2, `TokenService`, `refresh_tokens`). |
| Token verification in the API | **Keep `AuthGuard`**, but verify Supabase access tokens: asymmetric signing keys via JWKS (`jose.createRemoteJWKSet`), `aud = authenticated`, `sub` = user id. Add a check that the user still exists and isn't banned. |
| Data access | **Keep the API as the only data path.** Clients never query tables directly. Triage, AI review, consent checks and medication rules live in the API, not in the database. |
| Consents, audit, rate limits on AI and uploads | Keep in the API (not auth concerns) |
| iOS | Use `supabase-swift` Auth only (Keychain session storage); send its access token to the API. Remove the refresh logic from `APIClient`. |
| Web | Use `@supabase/ssr` in the Next.js server with httpOnly cookies. Replace `lib/api/session.ts`, the refresh in `proxy.ts` and `features/auth/actions.ts`. |

### 2.3 Supabase Storage

| Item | Target |
|---|---|
| Bucket | `health-documents`, **private**, `file_size_limit` 20 MB, `allowed_mime_types` = `application/pdf`, `image/jpeg`, `image/png` |
| Object path | `{user_id}/{document_id}` (same as today) |
| Upload | API calls `createSignedUploadUrl(path)`; the client uploads directly; the API still checks magic bytes before processing |
| Download | Server-side only (the AI worker reads with the service role); no public URLs |
| Delete | With the document, and on account deletion (list and remove the prefix) |
| Code | New `SupabaseObjectStorage implements ObjectStorage`. Remove `PUT /v1/uploads/:token` and `LocalObjectStorage` from production wiring; keep them for development. |
| Files to move | Every object under `STORAGE_DIR/{user_id}/{document_id}`. Development data only today: **no production files exist yet.** |

### 2.4 Embeddings and pgvector

None exist today; memory retrieval is Postgres full-text search. Planned:

| Use | Column | Notes |
|---|---|---|
| Relevant health memories for chat context | `health_memories.embedding vector(N)` + HNSW index (`vector_cosine_ops`) | Hybrid ranking: full text + vector. Re-embed when a fact is edited. |
| Report content for "what did my blood test say?" | New `document_chunks(id, user_id, document_id, page, text, embedding)` | Chunks from the AI extraction (findings + summary), not raw OCR |
| Past conversation recall | New `conversation_summaries(user_id, conversation_id, summary, embedding)` | Optional; later |

- **Embedding provider (decision needed):** Anthropic has no embeddings API. Options:
  - **Voyage AI**, Anthropic's recommended partner. Adds a third processor of health data.
  - **Supabase's built-in `gte-small`** (384 dimensions) in an Edge Function. Keeps data in Supabase; lower quality.
- **Processing:** embeddings are generated in a **background job** (Redis), never inline in a request.
- **Consent:** covered by the existing `ai_processing` consent. Update its wording to mention retrieval.

### 2.5 Row-level security

Principle: RLS on **every** table in `public`, as defence in depth even though clients go through the API.

The API should run its queries under the caller's identity: per transaction, `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', …)`. That way a missing `WHERE user_id = …` can't leak data. Background workers use the service role explicitly.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own | via sign-up trigger | own | cascade only |
| `health_conditions`, `allergies`, `medications` | own | own | own (medications: `active` only) | own |
| `health_memories` | own | own, `status IN ('user_reported','user_confirmed')` | own (sets `user_confirmed`) | own |
| `conversations` | own | own | own (title) | own |
| `messages` | own | own **`role = 'user'` only** (assistant turns are written by the service role) | none | via conversation |
| `documents` | own | own (`status = 'awaiting_upload'`) | service role only (status, result) | own |
| `document_chunks`, `conversation_summaries` | own | service role | service role | cascade |
| `health_measurements` | own | own (when consented; enforced in the API) | none | own (`source = 'apple_health'` bulk delete) |
| `timeline_events` | own | own, `source_type = 'user_entered'` | none | own, `source_type = 'user_entered'` |
| `consents` | own | own | **none** (append-only history) | none |
| `mood_checkins` | own | own | none | cascade |
| `plans` | own | own | own | cascade |
| `ai_usage`, `safety_events`, `audit_logs` | **none** | service role | none | none |

"Own" = `user_id = (select auth.uid())`. Writing `(select auth.uid())` with the subselect caches it per statement.

**Storage (`storage.objects`, bucket `health-documents`):**
- **SELECT and DELETE:** only when `(storage.foldername(name))[1] = auth.uid()::text`.
- **INSERT:** only through signed upload URLs.
- **UPDATE:** none.

Every policy needs a test: a second user must get nothing, and anonymous requests must be denied.

### 2.6 Redis

| Use | Target |
|---|---|
| Rate limiting | `RateLimiter` backed by Redis (atomic sliding window: Lua or `rate-limiter-flexible`), same `@RateLimit` buckets. Decide per bucket: **fail closed** for auth and uploads, **fail open** for reads. |
| Background jobs | BullMQ queues behind the existing `JobQueue` role:<br>• `document-processing`: 3 retries with exponential backoff, idempotent by document id<br>• `embeddings`<br>• `account-deletion` (storage cleanup) |
| Workers | A separate worker process (`src/worker.ts`) that scales independently of the HTTP API |
| Recovery | A sweeper marks documents stuck in `processing` beyond N minutes as `failed` with an honest reason, or re-enqueues them |
| Dead letter | Failed jobs are kept for inspection. Job payloads carry ids only, **never health content**. |

### 2.7 Environment variables

| Variable | Service | Notes |
|---|---|---|
| `DATABASE_URL` | API, worker | Supavisor pooled URL (6543) |
| `DATABASE_DIRECT_URL` | Migrations | Direct connection (5432) |
| `SUPABASE_URL` | API, worker, web, iOS | Project URL |
| `SUPABASE_ANON_KEY` (publishable key) | web, iOS | Safe in clients |
| `SUPABASE_SERVICE_ROLE_KEY` (secret key) | API, worker **only** | Never in clients |
| `SUPABASE_JWKS_URL` | API | Derivable from `SUPABASE_URL` |
| `SUPABASE_STORAGE_BUCKET` | API, worker | `health-documents` |
| `REDIS_URL` | API, worker | TLS (`rediss://`) |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | API, worker | Existing |
| `EMBEDDINGS_PROVIDER`, `VOYAGE_API_KEY` (if chosen) | worker | New |
| `NODE_ENV`, `PORT`, `CORS_ORIGINS`, `PUBLIC_BASE_URL` | API | Existing. `PUBLIC_BASE_URL` is no longer needed once local uploads are removed. |
| `HEALTHMATE_API_URL` | web server | Existing |
| `HM_API_BASE_URL`, `HM_SUPABASE_URL`, `HM_SUPABASE_ANON_KEY` | iOS build settings | Anon key only |
| **Removed:** `JWT_SECRET`, `PGLITE_DIR` (production), `STORAGE_DIR` (production) | | |

---

## 3. What must change before production (independent of the vendor)

1. **Durable storage and jobs:** nothing may live only in process memory or on local disk.
2. **Token revocation:** the guard must reject tokens for deleted or banned users. Supabase plus a user-status check covers this.
3. **Row-level security,** with tests, as defence in depth.
4. **Worker separation and stuck-job recovery** for document processing.
5. **Malware scanning** before any uploaded file is processed.
6. **Compliance decision (HIPAA / GDPR special-category data):**
   - Supabase's HIPAA add-on needs a Business Associate Agreement (BAA) on an eligible plan.
   - Anthropic zero-data-retention or a BAA for the AI.
   - The same for any embeddings provider.
   - Data residency (project region).
7. **Secrets** in a secrets manager; the service-role key only on the server.
8. **Backups and point-in-time recovery** enabled; a documented restore drill.
9. **Observability:** structured logs with health content redacted (already the policy), error tracking, queue metrics.
10. **CI against real Postgres** (Supabase CLI local stack), not only PGlite.
11. **Demo mode** must be impossible in production. It already refuses `NODE_ENV=production`; keep it out of production images too.

---

## 4. Migration plan (non-destructive, in order)

No production users or files exist yet, so there's no user or data migration. Each phase ships behind the existing interfaces and can be rolled back by configuration.

| Phase | Work | Rollback |
|---|---|---|
| 0. Decide | Supabase project per environment (region, plan, HIPAA add-on); Redis provider; embeddings provider; BAAs | — |
| 1. Database | Add `supabase/` (CLI). Port `0001–0003` into Supabase migrations unchanged. Point `DATABASE_URL` at the pooler. Add a CI job running API tests against the Supabase local stack. | Point `DATABASE_URL` back |
| 2. Redis | `RedisRateLimiter` and `BullJobQueue` behind the existing classes, selected by `REDIS_URL`; new `src/worker.ts`; stuck-document sweeper | Unset `REDIS_URL` (in-memory) |
| 3. Storage | `SupabaseObjectStorage`; bucket + storage policies as a migration; keep the magic-byte check | Switch the implementation back |
| 4. Auth | Migration `0004`: `profiles` from an `auth.users` trigger, FKs to `auth.users`, drop `users`/`refresh_tokens`. `AuthGuard` verifies Supabase JWTs through JWKS. iOS → `supabase-swift` Auth; web → `@supabase/ssr`. Account deletion → admin API + storage cleanup. Delete `modules/auth`. | Branch-level; the old auth stays in git history |
| 5. RLS | Policies migration; per-transaction `authenticated` role + claims in `PgDatabase`; policy tests (cross-user, anonymous) | Disable per table (emergency only) |
| 6. pgvector | `create extension vector`; embedding columns + HNSW; embeddings queue; hybrid retrieval in `MemoryService.relevant` | Feature flag off (falls back to full text) |
| 7. Hardening | Malware scan step, observability, backups drill, load test of the worker queue | — |

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Health data regulated as HIPAA/PHI or special-category data without BAAs | Phase 0 decision; don't onboard real users before it's made |
| RLS mistakes: leaks, or locking out legitimate access | Deny-by-default, tests for every policy with two users, API still filters by user |
| Service-role key leaking into a client | Only in API and worker environments; CI check that client bundles don't contain it |
| Supavisor transaction mode vs session features (`SET`, advisory locks, named prepared statements) | Use `SET LOCAL` inside transactions only; no session state |
| JWT signing-key rotation | Verify via JWKS with caching, not a pinned secret |
| Redis outage | Explicit fail-open/fail-closed per bucket; the queue retries; the sweeper recovers stuck work |
| Duplicate job execution (at-least-once delivery) | Idempotent processors keyed by document id; status checks before writing |
| Embeddings provider as a new processor of health data | Consent wording, BAA, retention settings |
| Account deletion missing Storage objects or embeddings | One deletion job: storage prefix, then `auth.admin.deleteUser`, then the cascade; tested |
| Supabase lock-in | Keep the `Database`, `ObjectStorage`, `JobQueue` and `AiProvider` interfaces; no Supabase client calls outside adapters |
| Client auth rewrite breaking sessions | Ship iOS and web auth changes together with the guard change; no production users yet |

---

## 6. Files to change

**API (`services/api`)**

| File | Change |
|---|---|
| `src/config.ts` | New variables (2.7); drop `JWT_SECRET` and the production use of PGlite and storage directory |
| `src/db/database.ts` | Per-transaction claims for RLS; pooler-safe settings |
| `migrations/*` → `supabase/migrations/*` | Port 0001–0003; add 0004 auth/FKs, 0005 RLS, 0006 storage bucket + policies, 0007 pgvector |
| `src/common/auth.ts` | Verify Supabase JWT through JWKS; user-status check |
| `src/modules/auth/*` | **Delete** (register, login, refresh, logout, `TokenService`, argon2) |
| `src/modules/account/account.service.ts` | Deletion via the admin API + storage prefix cleanup; export unchanged |
| `src/common/rate-limit.ts` | Redis-backed store |
| `src/modules/documents/job-queue.ts` | BullMQ implementation; new `src/worker.ts` |
| `src/modules/documents/storage.ts` | Add `SupabaseObjectStorage` |
| `src/modules/documents/documents.controller.ts` | Remove `UploadsController` from production wiring |
| `src/modules/documents/documents.service.ts` | Idempotent processing; sweeper |
| `src/modules/memory/memory.service.ts` | Hybrid retrieval (full text + vector) |
| `src/modules/ai/*` | Embeddings provider interface (new file) |
| `src/app.module.ts`, `src/main.ts`, `src/demo.ts` | Adapter selection by configuration |
| `test/helpers.ts` + tests | Supabase-local test context; RLS and cross-user policy tests |
| `package.json` | Add `@supabase/supabase-js`, `bullmq`, `ioredis`; remove `@node-rs/argon2`; keep `@electric-sql/pglite` as a dev dependency only |

**Web (`apps/web`)**: `src/lib/api/session.ts`, `src/proxy.ts`, `src/features/auth/actions.ts`, `src/features/auth/sign-in-form.tsx` (password reset, email confirmation), `package.json` (`@supabase/ssr`).

**iOS (`apps/ios`)**:
- `HealthMateCore/API/APIClient.swift` and `Endpoints.swift` (auth endpoints; token source)
- `HealthMate/Services/SessionStore.swift`, `KeychainTokenStore.swift`
- `HealthMate/Features/Onboarding/SignInView.swift` (password reset, Sign in with Apple)
- `project.yml` (Supabase settings; `supabase-swift` package)

**CI and docs:** `.github/workflows/ci.yml` (Supabase local stack job), `docs/architecture.md`, `docs/roadmap.md`.
