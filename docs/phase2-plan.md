# Phase 2 plan — real accounts and the long-term health record

Phase 1 finished the UI on sample data (Preview mode). Phase 2 connects it to real accounts and a
real, long-lived health record. It is split so each part can be verified before the next starts:

| Part | Scope | Status |
|---|---|---|
| **2A** | Real authentication (Supabase Auth, email/password), user profile and preferences, normalized longitudinal health schema with provenance, health-memory foundation, RLS/storage review, data controls | **this document** |
| 2B | Daily health records and Apple Health (HealthKit): permissions, sync, history import, offline/error states — [`phase2b-plan.md`](phase2b-plan.md) | done |
| 2C | Long-term health memory + real AI chat: memory lifecycle and controls, ranked budgeted retrieval, relevant daily data, "based on" transparency — [`phase2c-plan.md`](phase2c-plan.md) | in progress |
| 2D | OAuth (Apple, Google), push notifications | not started |

Rules that apply to every part: [`CLAUDE.md`](../CLAUDE.md). Memory design:
[`health-memory-architecture.md`](health-memory-architecture.md). Backend/Supabase details:
[`backend-supabase-migration.md`](backend-supabase-migration.md).

## 1. Where Phase 1 left things (inspection, before any Phase 2A change)

**Already real (built before Phase 1, verified by CI's Supabase job):**

- NestJS API with a `Database` interface over `pg` (Supabase) or PGlite (dev/tests), migrations
  `0001`–`0007` mirrored to `supabase/migrations`.
- `SupabaseIdentityProvider`: register, login, refresh, logout, password reset request/complete,
  account deletion (admin API, server-side secret key). Access tokens verified locally via JWKS.
  `LocalIdentityProvider` (argon2id + rotating refresh tokens) for dev/tests/demo.
- `auth.users` triggers that create/delete/sync `public.users` + `profiles` (same id).
- RLS on every `public` table, owner policies, private Storage buckets with `<user>/<id>` paths,
  signed URLs issued only after the API's ownership check.
- Health memory with provenance values `user_reported`, `document_extracted`,
  `clinician_provided`, `healthkit`, `ai_inferred`, `user_confirmed`, `superseded`; a trigger
  that refuses promotion to `user_confirmed` without an explicit confirmation; RLS that forbids a
  user session from creating `ai_inferred` rows; pgvector embeddings.
- Export (`GET /v1/me/export`) and idempotent account deletion.

**Mocked / Preview-only (the gaps Phase 2A closes):**

| Client call | Before 2A | Phase 2A |
|---|---|---|
| `GET /v1/me/account` (email, verified, sign-in methods, onboarding) | Preview only | real |
| `POST /v1/me/onboarding` | Preview only | real (`profiles.onboarding_completed_at`) |
| `PATCH /v1/me/profile` `goals`, units | Preview only (`goals`), units device-only | real (`profiles.goals`, `profiles.unit_system`) |
| `GET/PUT /v1/me/notification-preferences` | Preview only | real (`notification_preferences`) |
| `POST /v1/auth/change-password` | Preview only | real (local + Supabase) |
| `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification` | Preview only | real (Supabase `token_hash` verification, resend) |
| `POST /v1/auth/oauth` | Preview only | **kept unavailable** (501) — UI structure preserved, clients already say "isn't available on this server yet"; real OAuth is 2D |
| `GET/PATCH /v1/timeline/:id` | Preview only | real (own `user_entered` entries only) |
| `PATCH /v1/conversations/:id` (rename) | Preview only | real |
| `GET/PATCH /v1/care/providers/:id`, `GET /v1/care/appointments/:id` | Preview only | real |
| `GET /v1/notifications`, `POST read-all`, `PATCH/DELETE /:id` | Preview only | real (`notifications` table; server-written) |
| Conditions/allergies/medications: dates, corrections, history | only name/status/source | onset/resolved, started/stopped, confidence, source reference, supersession |
| Treatment plans | plan items only | `treatment_plans` + `plan_items.treatment_plan_id` (schema + API read; UI in 2B) |
| AI context: dates and provenance of memories | fact + status only | "User reported … (about 3 months ago, 2026-06-30)", current vs past separated |
| Operational log retention | kept forever | configurable (`*_RETENTION_DAYS`), health data never auto-expires |

Clients: iOS and web default to Preview mode in development and switch to the API with
`HEALTHMATE_DATA_SOURCE=api` (web) / `-hmDataSource live` (iOS). **Preview mode stays** and is still
the default for UI work and CI screenshots.

## 2. Phase 2A design decisions

1. **One auth contract, server-side Supabase.** Clients keep calling `/v1/auth/*` on our API; the
   API talks to Supabase Auth. Clients never hold the Supabase secret key, the database URL or an
   AI key. (The publishable key isn't needed by clients either — nothing talks to Supabase
   directly.)
2. **Sessions.** Web: httpOnly cookies (`hm_at`, `hm_rt`, `hm_exp`), refreshed by the Next.js
   proxy 30 s before expiry; a 401 sends the person to `/sign-in?expired=1`. iOS: tokens in the
   Keychain, refreshed on 401 once, then signed out with an "expired" message. Logout revokes the
   refresh token server-side (Supabase `logout?scope=local`).
3. **Password change** requires the current password; on Supabase it signs out every *other*
   session (`scope=others`). **Password reset** signs out every session (`scope=global`).
4. **Email verification**: Supabase's confirmation email must link to
   `<web>/verify-email/confirm?token_hash={{ .TokenHash }}&type=email` (template in
   `supabase/config.toml` docs below). The web route exchanges it through the API for a session.
5. **Minimal profile.** Name, date of birth (age is derived, never stored), optional sex (only
   because some reference ranges depend on it; "prefer not to say" allowed), height, time zone,
   goals, unit system, onboarding completion. No address, phone, ethnicity, insurance or ID
   numbers.
6. **Normalized facts, not a JSON blob.** Each fact table carries `user_id`, `source`
   (provenance), `source_ref`, `created_at`, an event date (`onset_on`, `started_on`, `noted_on`,
   `occurred_at`), status, `confidence`, `confirmed_at`, and `superseded_by`/`superseded_at`.
7. **Corrections vs. history.** A *correction* supersedes the old row (kept, linked, excluded from
   "current"). A *change in the person's health* (a medication stopped, a condition resolved) is
   history: the row gets its end date and stays true for its period. See the memory doc §4.
8. **AI inference never becomes history on its own.** Structured fact tables don't accept
   `ai_inferred` at all (check constraints). Only `health_memories` can hold an inference, and only
   the person can confirm it (trigger + RLS). An inference can be confirmed, superseded or deleted
   — never silently relabelled as another provenance (trigger, new in 2A).
9. **Retention.** Health history never expires automatically. The person deletes items, exports
   everything, or deletes the account. Operational logs (audit, AI usage, safety events — no
   health content) are pruned after configurable periods.
10. **pgvector**: already in place (384-d, HNSW). 2A only adds metadata (category, dates) that
    retrieval will filter on in 2B; no new embedding work.

## 3. Deliverables (2A)

- Migration `0008_health_record_foundation.sql` (+ Supabase mirror): profile fields,
  `notification_preferences`, `notifications`, provenance/temporal columns on conditions,
  allergies, medications, symptoms and memories, `treatment_plans`, `current_*` views, timeline
  update policy, email-verification sync, memory provenance guard.
- API: every "Preview only" route above, plus corrections (`PATCH` conditions/allergies,
  medication start/stop dates), memory supersession, treatment plans (read + create), retention
  housekeeping, export of all new tables.
- Shared types (TS) and `HealthMateCore` (Swift) kept in sync.
- Tests: API (auth flows incl. Supabase adapter with a fake GoTrue, profile/preferences,
  notifications, timeline edit, temporal context), migration + RLS (every new table, provenance
  guard), web unit, Swift Core, existing e2e and iOS UI tests unchanged.

## 4. Manual setup for a real Supabase project

1. `supabase link --project-ref <ref>` then `npx supabase db push` (or `npm run db:migrate -w @healthmate/api`).
2. Auth → URL configuration: Site URL = the web app; add `<web>/reset-password` and
   `<web>/verify-email/confirm` to redirect URLs. Set `PASSWORD_RESET_REDIRECT_URL`.
3. Auth → Email templates → Confirm signup: link to
   `{{ .SiteURL }}/verify-email/confirm?token_hash={{ .TokenHash }}&type=email`.
4. Configure custom SMTP before inviting real people (built-in sender is rate-limited).
5. API env (server only): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
   `DATABASE_URL`. Web: `HEALTHMATE_DATA_SOURCE=api`, `HEALTHMATE_API_URL`. iOS: `-hmDataSource live`
   and `HM_API_BASE_URL`.

## 5. Out of scope for 2A (tracked for later parts)

Real OAuth, push delivery, MFA, AI extraction from documents into structured facts, a memory
confirmation UI beyond the existing "Confirm" action, HIPAA/BAA and regional hosting decisions,
malware scanning of uploads.
