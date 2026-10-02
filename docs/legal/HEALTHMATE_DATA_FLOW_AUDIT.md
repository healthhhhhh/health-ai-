# HealthMate — Data Flow Audit (US-first launch)

> **Status: internal working document. Not legal advice, not a privacy policy, and not a statement of compliance.**
> Review date: **2026-10-01**. Audited code: branch `claude/inspiring-newton-qmirnd` at `74c300e` (application code as of `8730023`).
> Prepared from the source code for review by the operator and a US privacy/healthcare lawyer.

## 0. How to read this document

Every statement is tagged:

| Tag | Meaning |
|---|---|
| **[CODE]** | Verified by reading the source in this repository (file paths given). It describes what the code does, not what any deployment does. |
| **[DEPLOY]** | Depends on how production is configured or hosted. That configuration does not exist yet or is not in the repository. |
| **[FACT?]** | Needs further factual investigation before anyone can rely on it. |
| **[COUNSEL]** | A question for a US privacy/healthcare lawyer. |
| **[GAP]** | A difference between what the code does and what a launch is likely to need. |

Confirmed product decisions used as inputs (from the operator, 2026-10-01): an individual developer with no registered company; the United States as the first market; iOS plus a website; the features listed in §1.

**Age policy (revised 2026-10-01).** The earlier input "minimum age 18" is withdrawn as a permanent policy.

| Layer | Status |
|---|---|
| **Desired long-term product** | An **all-ages** health companion: children, teenagers and adults. |
| **Proposed initial launch scope** | **Undecided.** Options and a recommendation are in the Checklist (§6.7). |
| **Implemented in code** | **No age determination and no age-based controls of any kind**: no age screen, no parental consent, no parent or guardian accounts, no child- or teen-specific behaviour (§8). |

Nothing in this audit should be read as saying an age gate, parental consent or child-safety feature exists. Nothing below assumes a company name, address, support contact, retention period, provider contract term or security certification. None of these exist yet.

---

## 1. System overview

| Component | Location in repo | Role |
|---|---|---|
| iOS app (SwiftUI) | `apps/ios/HealthMate`, `apps/ios/Packages/HealthMateCore` | Client. Reads HealthKit on device; voice input; camera/photo upload; local reminders; nearby-care search (MapKit). |
| Web app (Next.js) | `apps/web/src` | Client. Server-rendered; session tokens held in httpOnly cookies (`apps/web/src/lib/api/session.ts`). |
| API (NestJS) | `services/api/src` | Single backend for both clients. All health routes are under `/v1/*` behind `AuthGuard` (`services/api/src/common/auth.ts`). |
| AI Gateway | `services/api/src/modules/ai/*` | The only path to an AI model. It picks a provider per task and holds no model keys on clients (`config.ts`: `ANTHROPIC_API_KEY` is server-only). |
| Database | Postgres (Supabase in production; embedded PGlite in dev/test) | All health records. Schema: `services/api/migrations/0001…0014` (mirrored in `supabase/migrations`). |
| Object storage | Supabase Storage private buckets `medical-reports`, `health-images`, `avatars` (`0005_supabase_security.sql`); a local directory in dev | Uploaded reports and photos. |
| Embeddings | Supabase Edge Function `supabase/functions/embed` (gte-small, runs inside the Supabase project) | Turns memory text into vectors for retrieval. |
| Jobs and rate limits | Redis/BullMQ when `REDIS_URL` is set, else in-process | Document processing, embedding, push dispatch. |
| Push | `PUSH_PROVIDER=log` (dev, nothing sent), `apns`, or `none` (`services/api/src/modules/notifications/push.ts`) | Optional copies of in-app notifications. |

**Features in scope**, as stated by the operator and checked in code:

| Feature | Where in code |
|---|---|
| Health Q&A | `modules/chat` |
| Report and image uploads | `modules/documents` |
| Long-term memory | `modules/memory` |
| HealthKit | `apps/ios/HealthMate/Services/HealthKitService.swift`, `modules/health-data` |
| Tracking (symptoms, mood, measurements) | `modules/symptoms`, `modules/checkins`, `modules/health-data` |
| Care discovery | `apps/ios/.../Care/CareFinderView.swift`, `apps/web/src/features/care-links.tsx`, `modules/care` for the user's own providers and appointments |
| Task generation | Plan items in `modules/plan`. **[CODE]** The AI `task_generation` task has a schema (`ai.tasks.ts`), but no feature calls it today. Plan items are created by the user. |

---

## 2. Data inventory: what is collected, why, and where it is stored

All tables live in the `public` schema. "Owner" means `user_id` with `ON DELETE CASCADE` from `users` unless noted otherwise.

### 2.1 Account and identity

| Data | Source | Purpose | Storage | Notes |
|---|---|---|---|---|
| Email, password hash (argon2id, local auth) or a Supabase Auth identity | Sign-up (`POST /v1/auth/register`) | Authentication | `users`, Supabase `auth.users` [DEPLOY] | **[CODE]** Sign-up takes `email`, `password`, `firstName`, `lastName`, `timeZone` (`auth.controller.ts` `RegisterBody`). **No age, date-of-birth or age attestation is collected** (see §8). |
| Google identity (subject, email) | `POST /v1/auth/oauth` | Sign-in | `auth_identities` | **[CODE]** Server-side verification is implemented (`modules/auth/oauth.ts`). No client is wired: no Google SDK in iOS or web. Apple sign-in is declared in the API schema but has no verifier. |
| Refresh tokens | Local auth | Sessions | `refresh_tokens` | Rotated, with reuse detection (`auth.refresh_reuse_detected`). |
| Push device tokens | iOS | Push notifications | `push_devices` (AES-encrypted token plus hash) | Requires `PUSH_TOKEN_KEY`. Production defaults to `none`. |
| Time zone, name | Sign-up and profile | Personalisation, local-day calculations | `profiles` | |

### 2.2 Health data (consumer health data under most state definitions — see the checklist)

| Data | Source | Purpose | Storage |
|---|---|---|---|
| Date of birth, sex, height, goals | Profile (`PATCH /v1/me`) | Profile; the AI context gets the **age in whole years**, never the date (since 2026-10-02) | `profiles` |
| Conditions, allergies, medications (instructions verbatim), treatment plans | User-entered, or `source` = `clinician_provided` or `document_extracted` | Health record; AI context | `health_conditions`, `allergies`, `medications`, `treatment_plans` |
| Health memories (facts with provenance: `user_reported`, `user_confirmed`, `document_extracted`, `healthkit`, `clinician_provided`, `ai_inferred`, `superseded`) and embeddings | Chat, user, documents | Long-term memory, AI retrieval | `health_memories` (pgvector column) |
| Chat messages and AI answers (structured payload, triage level) | Chat | Q&A history | `conversations`, `messages` |
| Uploaded reports (PDF/JPEG/PNG) and photos | Upload | AI summary or photo check | Storage buckets, plus `medical_documents`, `health_images`; results in `document_analysis`, `document_extractions`, `document_pages`, `image_analysis` |
| Optional note on a photo | Upload | Context for the image check | `health_images.note`. **[CODE]** Set to NULL once the analysis is saved (`documents.service.ts` `saveImage`). |
| HealthKit daily aggregates: steps, heart rate, resting heart rate, active energy, weight, sleep | iPhone HealthKit, read-only (`HealthKitService.swift`) | Trends; AI context | `daily_health_records`, `health_sync_runs`, `healthkit_connections` |
| Manual measurements | User | Tracking | `health_measurements` |
| Symptoms and symptom events | User | Tracking | `symptoms`, `symptom_events` |
| Mood check-ins | User | Tracking | `mood_checkins` (server). **[CODE]** Also stored on device in `UserDefaults` (`UserDefaultsMoodStore`, `HealthMateCore/Health/MoodStore.swift`). |
| Plan items, completions, reminders | User | Plan/tasks | `plans`, `plan_items`, `task_completions`, `reminders` |
| Care providers, appointments | User | Care organisation | `care_providers`, `appointments` (soft delete `deleted_at`) |
| In-app notifications | System | Notices | `notifications` |
| Timeline | System and user | History view | `timeline_events` |

### 2.3 Consent, operational and security records

| Data | Purpose | Storage | Linkage after account deletion |
|---|---|---|---|
| Consents (`ai_processing`, `document_processing`, `health_data_sync`, `voice`), append-only with `version` = `"2026-09"` | Records the user's choices | `consents` | Deleted (cascade) |
| Audit log (action plus identifiers or counts; e.g. `account.delete`, `document.download`) | Security trail | `audit_logs` | **[CODE][GAP]** `user_id` has **no foreign key**, so rows keep the deleted user's UUID until pruned (`AUDIT_LOG_RETENTION_DAYS`, default 400). |
| Safety events (triage `level`, `rule_ids`, channel) | Observability of urgent and emergency escalations | `safety_events` | **[CODE][GAP]** `ON DELETE SET NULL`: de-linked but kept (default 730 days). Rule ids show that an urgent or emergency symptom was raised, which is plausibly *inferred health data* [COUNSEL]. |
| AI usage (task, provider, model, tokens, cost, status) | Cost control and accounting | `ai_usage` | **[CODE]** `ON DELETE SET NULL`, kept 400 days by default. The task name (e.g. `image_analysis`) reveals feature use. |
| AI budget ledger | Monthly cost limit | `ai_budget_periods`, `ai_budget_reservations` | Cascade delete |
| Rate-limit keys | Abuse prevention | Redis or memory | Keyed by user id, or a **SHA-256 hash of the IP truncated to 16 hex chars** (`common/rate-limit.ts`). IPs are not stored in the database. |

### 2.4 Data kept on the device

| Data | Where | Notes |
|---|---|---|
| Session tokens (iOS) | Keychain, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (`KeychainTokenStore.swift`) | Not synced to iCloud |
| Session tokens (web) | httpOnly cookies, `Secure` in production, `SameSite=Lax` | |
| Mood entries, last-sync time, UI preferences | `UserDefaults` | **[GAP]** Not cleared by the server-side account deletion. Whether sign-out or deletion clears them on device is **[FACT?]**. |
| Local reminders | `UNUserNotificationCenter` | Lock-screen text is generic unless "show details" is on (`ReminderPlanner.swift`) |
| HealthKit | Apple's HealthKit store | HealthMate reads only and writes nothing (`requestAuthorization(toShare: [])`) |

---

## 3. Processors, subprocessors and other recipients

**[COUNSEL][FACT?]** None of the contracts, DPAs, BAAs, data-retention terms, training-use terms or processing locations below have been reviewed. This audit makes no claim about any provider's privacy terms.

| Recipient | What it receives | When | Code reference | Status |
|---|---|---|---|---|
| **Anthropic (Claude API)** | Full chat context, documents and photos — see §4 | Only when `AI_PROVIDER=anthropic` or an `AI_ROUTES` entry uses it and `ANTHROPIC_API_KEY` is set | `modules/ai/anthropic.provider.ts` | Paid API. Not used in development per the operator's constraint. Terms, retention, zero-data-retention availability, training use and BAA availability are all **[FACT?]**. |
| **Supabase** (Postgres, Auth, Storage, Edge Functions) | All stored data; auth emails; memory text sent to the `embed` function | Production | `modules/auth/identity.ts`, `modules/documents/storage.ts`, `modules/memory/embeddings.ts`, `supabase/functions/embed/index.ts` | Project region, plan, backups/PITR retention, log retention and SMTP sender are **[DEPLOY]**. |
| **Redis host** | Job payloads with **identifiers only**: `{userId, kind, id}`, `{userId, memoryId}`, `{userId, notificationId}` | When `REDIS_URL` is set | `documents/job-queue.ts`, `memory.service.ts:323`, `push.service.ts` | Provider **[DEPLOY]** |
| **API and web hosting provider(s)** | All API traffic; process logs | Production | — | Not chosen **[DEPLOY]** |
| **Apple — APNs** | Device token; notification title/body (generic unless the user turns on "show details") | `PUSH_PROVIDER=apns` | `notifications/push.ts`, `push.service.ts` (`PRIVATE_PUSH`) | Needs the paid Apple Developer Program |
| **Apple — MapKit local search** (iOS care finder) | Search phrase for a care type (e.g. emergency department, clinic, pharmacy) and the region around the user's location | User opens Care finder | `CareFinderView.swift` (`MKLocalSearch`) | Location never reaches HealthMate's server **[CODE]**, but Apple receives a health-related query plus location **[COUNSEL]** |
| **Apple — Speech** | Voice audio | Voice input | `SpeechRecognizer.swift` | **[CODE]** On-device only *when the device supports it* (`requiresOnDeviceRecognition` set conditionally). Otherwise audio may go to Apple's servers. **[GAP]** The consent copy "Audio is transcribed and not kept" does not mention this. |
| **Google — Maps** (web) | Address, or care-type phrase plus "near me" | User clicks a link | `features/care-links.tsx`, `care/team/[id]/page.tsx`, `care/appointments/[id]/page.tsx` | User-initiated navigation to Google |
| **findahelpline.com** | Nothing except the navigation itself | User clicks | `features/chat/escalation-card.tsx`, `app/(app)/care/page.tsx` | Third-party site |
| **Google — sign-in key set** | Nothing about the user (the server fetches public keys) | Google sign-in | `modules/auth/oauth.ts` | |
| **Error reporting (Sentry)** | Nothing | — | `config.ts` defines `SENTRY_DSN`, but **no SDK is installed** in `services/api/package.json`, `apps/web/package.json` or iOS | **[CODE]** Not integrated. If it is added later, it must be re-audited. |
| **Analytics or advertising SDKs** | — | — | **[CODE]** None found in the API, web or iOS dependencies; no third-party scripts in web; fonts self-hosted (`@fontsource-variable/inter`) | |

**International transfers.** **[CODE]** Nothing in the code chooses a region. **[DEPLOY][FACT?]** The Supabase project region, the hosting region and the locations where Anthropic processes data are not determined. A US-only launch does not by itself keep processing in the US.

---

## 4. AI provider data-flow inventory

### 4.1 Providers in the code

| Provider (registry name) | File | Network calls | Allowed in production |
|---|---|---|---|
| `anthropic` | `anthropic.provider.ts` | **Yes** — Anthropic Messages API via `@anthropic-ai/sdk` | Yes, if a key is set |
| `development` | `development.provider.ts` (extends `demo.provider.ts`) | **No** — neither file contains `fetch`, an SDK or any I/O; it returns strings built in memory | **No** — `loadConfig` throws "The development AI provider is for development only" when `NODE_ENV=production` (`config.ts`); tested in `test/development-ai.test.ts` ("offers an offline development provider … refused in production") |
| `demo` | `demo.provider.ts` | No | Used by `npm run demo` only |
| `unavailable` (`none`) | `anthropic.provider.ts` `UnavailableProvider` | No | Yes. AI features report that they are unavailable. |
| `FakeAiProvider` | `fake.provider.ts` | No | Tests only |

**What the development provider really does [CODE]:**
- It *receives* the same `AiProviderRequest` as a real provider: system prompt, health context, messages, and file bytes for reports and photos.
- It sends nothing anywhere.
- For `health_chat`/`complex_health`, `developmentAnswer()` copies the selected memory and daily-data lines **verbatim** from the `<health_context>` block into the answer text. That text is then stored in `messages` like any answer.
- For `report_analysis`/`image_analysis` it returns "Demo mode: … not analysed" and ignores the file.
- It reports `demo: true`, so clients show the demo notice.
- **Consequence:** in development, health context ends up in chat history. That data stays in the local database.

### 4.2 What Anthropic receives, by task (when configured)

The default production route sends every AI task to `AI_PROVIDER`; `AI_ROUTES` can change provider, model or effort per task (`ai.routing.ts`).

| Task | Triggered by | Content sent | Code |
|---|---|---|---|
| `health_chat` / `complex_health` (urgent triage or medication questions) | `POST /v1/conversations`, `POST /v1/conversations/:id/messages` | See the list below this table | `chat.service.ts` `respond()`; `chat.prompts.ts`; `profile.service.ts` `contextSummary()`; `memory-retrieval.ts`; `health-data/daily-health-context.ts` |
| `report_analysis` | `POST /v1/documents/:id/process` (background job) | **The complete uploaded file** (base64 PDF or image) and a fixed system prompt. No redaction: names, dates of birth, record numbers, addresses and clinician names printed on the document are sent as they are. PDF metadata is not stripped. | `documents.service.ts` `extractReport()` |
| `image_analysis` | Same | The photo, re-encoded as JPEG by the client, which drops EXIF/GPS (`DocumentsViewModel.swift` `ImagePreparation`; `apps/web/src/features/reports/upload-client.ts`); the area of concern; the user's note (≤500 chars) | `documents.service.ts` `analyseImage()` |
| `task_generation`, `summarization` | No caller | — | `ai.tasks.ts` (schemas only) |

What a chat request sends:
- the fixed system prompt;
- `Today` (date);
- the **profile summary** (**age in whole years** computed on the user's local date — the exact date of birth is not sent since 2026-10-02, `ageInYears` in `profile.service.ts`; sex, current and past conditions with source and dates, allergies and reactions, current medications with **instructions verbatim**, and past medications);
- memories selected by retrieval (with provenance labels; `ai_excluded` and superseded facts are left out);
- daily-health summaries for the metrics the question mentions, **derived from HealthKit data** (`dailyHealthContext`; 37-day window);
- safety notes (triage reasons);
- the **last 20 messages** of the conversation;
- the new message.

What it does not send:
- the email address, name or user id. **[CODE]** `userId` stays in the gateway for the budget and is not passed to the SDK. The first name is not in `contextSummary`.

Cross-cutting facts [CODE]:
- **Emergencies never reach any model.** Deterministic triage returns a fixed escalation (`chat.service.ts`; `@healthmate/safety`).
- **Consent gate:**
  - chat needs the latest `ai_processing` consent = granted (`chat.controller.ts`);
  - document create and process need `document_processing` (`documents.controller.ts`).
- **[CODE] Fixed 2026-10-02 (G6).** Consent is re-checked when work *executes*, not only when it is requested (`modules/account/processing-policy.ts`). `AiGateway.generate` refuses before any reservation or provider call. Withdrawing `document_processing` stops queued analyses in the same transaction. The worker re-checks before reading the file, and a result is stored only if permission still holds when it is saved. Memory embeddings need `ai_processing` when they run, and Apple Health writes re-check `health_data_sync`. Tests: `test/consent-enforcement.test.ts`. **Remaining limit:** a request already handed to the AI provider when consent is withdrawn cannot be recalled; its result is discarded but the provider has received it.
- **[GAP]** Daily health data from HealthKit flows to the AI provider under `ai_processing` consent. The `health_data_sync` consent copy ("Store Apple Health measurements you choose in your account") does not mention AI processing. Apple's HealthKit terms and Guideline 5.1.3 apply (see the checklist).
- **[GAP]** Consent copy says "our AI provider" (`settings/page.tsx:22–23`, `SettingsView.swift:56–57`) and does not name the third party. The iOS onboarding copy for `ai_processing` ("Lets the assistant use what you share in chat to answer", `AccountSetupView.swift:186`) does not say data leaves HealthMate. App Review Guideline 5.1.2(i) requires clear disclosure of sharing "with third-party AI" and explicit permission.
- **Logging:** the gateway and provider log task names, status codes, refusal categories and the model name. They never log prompt or answer content (`anthropic.provider.ts`, `ai.gateway.ts`). Tested: "the API key never appears in logs" (`test/ai-budget-audit.test.ts`).
- **Output validation** flags diagnosis-as-fact, dose instructions, medication changes and prompt injection; the chat then rewrites the answer once or falls back to a safe answer (`ai.tasks.ts`, `chat.service.ts`).

### 4.3 Embeddings (not a third-party AI company)

Memory text goes to the `embed` Edge Function running inside the same Supabase project (gte-small; `supabase/functions/embed/index.ts`). The function is protected by a shared secret, truncates input to 2,000 chars and does not log input. **[DEPLOY]** Supabase's own Edge Function request logging is not controlled by this code. In development the `hash` provider is local and deterministic.

---

## 5. Retention [CODE] and what is not decided

| Data | Current behaviour | Decision status |
|---|---|---|
| All health data in §2.2 | Kept **until the user deletes it or deletes the account**; there is no automatic expiry (`retention.ts` comment; `config.ts`) | **[COUNSEL]** Whether indefinite retention is acceptable; inactivity policy; MHMDA/CTDPA expectations |
| Photo note | Erased once the analysis is saved | — |
| `audit_logs`, `ai_usage`, `ai_budget_reservations` | Pruned after `AUDIT_LOG_RETENTION_DAYS` / `AI_USAGE_RETENTION_DAYS` (default **400**) by `pruneOperationalRecords` | These defaults are engineering placeholders, **not** legal retention periods |
| `safety_events` | `SAFETY_EVENT_RETENTION_DAYS` (default **730**) | Same |
| Supabase backups / PITR, platform logs | Not controlled by code | **[DEPLOY][FACT?]** |
| Data held by Anthropic | Unknown | **[FACT?][COUNSEL]** |
| Device-local data | Until the app is removed or the user clears it | **[FACT?]** whether sign-out or deletion clears it |

## 6. Deletion, export and correction [CODE]

**Account deletion** — `POST /v1/me/delete` (`account.service.ts`):
1. It requires the password, or a fresh linked Google identity token.
2. It marks `users.deletion_requested_at`.
3. It deletes all Storage files for the user, then the identity: Supabase Admin API `DELETE /admin/users/:id`, plus `DELETE FROM users`, which cascades to every owner table.
4. Interrupted deletions are finished by maintenance (`finishPendingDeletions`, every 5 minutes; `maintenance.ts`).
5. It is available in-app on iOS and web (App Review 5.1.1(v) requires in-app deletion).

**Deletion gaps [GAP]:**
1. `audit_logs` keeps the user UUID for up to 400 days.
2. `safety_events` and `ai_usage` are de-linked but kept.
3. Backups, platform logs and AI-provider copies are outside the code's control.
4. Device-local data is not covered.
5. There is no deletion confirmation email or receipt.
6. No process exists for verifying and fulfilling deletion requests that arrive outside the app (e.g. by email) — none can arrive yet because there is no contact channel.

**Granular deletion:** conversations, memories (including AI-exclusion and supersession), documents, symptoms, timeline entries made by the user, conditions, allergies, medications, care entries, and Apple Health data (`DELETE /v1/health-data/apple-health`).

**Export** — `GET /v1/me/export` (JSON, `healthmate-export-v2`): profile, records, memories, messages (text only), document metadata plus the latest analysis, daily health, consents and more.

**Export gaps [GAP]:**
- original uploaded files and avatars are not included;
- operational records, `safety_events` and structured message payloads are not included;
- there is **no list of third parties the data was shared with** (which MHMDA's access right requires).

**Correction:** the PATCH routes for profile, records, memories and timeline entries; supersession keeps history.

## 7. Security controls [CODE]

These are code-level controls only. They are **not** a security guarantee, certification or audit result.

- **Authorization:** every `/v1` health route uses `AuthGuard`. Queries are scoped by `user_id = $1`. Cross-user isolation is tested (`test/isolation.test.ts`, `test/rls.test.ts`).
- **Supabase RLS:**
  - Enabled on all public tables.
  - `anon` is revoked.
  - Owner-only policies (`0005_supabase_security.sql`).
  - Health-derived tables are read-only to clients (written by the API).
- **Storage:** private buckets with owner-folder policies. Downloads use 5-minute signed URLs (`GET /v1/documents/:id/file`). Uploads are sniffed for content type with a size cap (`storage.ts`).
- **Passwords and tokens:** argon2id (local auth) with rotating refresh tokens and reuse detection; Supabase Auth in production. Push tokens are encrypted at rest (AES; `push.ts`).
- **Transport and headers:** `no-store`, `nosniff`, `no-referrer`, CORS allow-list, rate limits on auth, export, delete and upload.
- **Clients:** iOS tokens live in the Keychain (this device only). Web tokens live in httpOnly cookies. Photos are re-encoded to drop EXIF/GPS on both clients.
- **Logging policy:** loggers write ids, counts, status codes and error *names*.

**Security gaps [GAP]:**
1. **Error logging (database errors fixed 2026-10-02).** `ErrorFilter` (`common/errors.ts`) used to log `exception.message` for unexpected errors, and Postgres errors such as not-null violations (`23502`) include `Failing row contains (…)` with row values. Database errors (any error carrying a SQLSTATE `code`) now log only the code plus the table and constraint names; tested in `test/dob-exposure.test.ts`. Other unexpected errors still log name, message and stack; application code does not put health values into error messages, but third-party library messages are not filtered.
2. **Web preview mode is on by default.** It is enabled whenever `HEALTHMATE_API_URL`/`HEALTHMATE_DATA_SOURCE` is unset (`apps/web/src/lib/preview/mode.ts`). It keeps per-session data in server memory (`lib/preview/store.ts`) and serves a public `/preview/inbox` (`proxy.ts` `PUBLIC_PATHS`). A misconfigured public deployment would accept real health data into a demo store.
3. **No CSP header** in `apps/web/next.config.ts` **[FACT?]** (hosting might add one).
4. **No incident response runbook, security contact, vulnerability disclosure policy, key rotation procedure or access-review process** in the repository.
5. **No encryption-at-rest configuration in code** (it relies on the provider) **[DEPLOY]**.
6. **The demo server logs a fixed demo login** (`demo.ts`). It is non-production only and contains no real credentials.

## 8. Age handling: actual implementation status [CODE]

**Update 2026-10-02 — age & consent Phase 2A (recording only).** The backend can now *record* an age band, but nothing uses it to restrict, route or protect anyone:
- Migration `0015_age_and_consent_foundation.sql` adds `users.age_band`, `age_status` and `age_assessed_at`. Every existing account is `unknown`, and nothing is inferred from `profiles.date_of_birth`.
- The append-only `age_assessments` table records band, source, outcome and time, and stores no date of birth. Clients can read their own rows but cannot write them (RLS).
- `POST /v1/me/age` computes the band on the server from a validated date of birth (`modules/account/age.ts`, `age.service.ts`).
- An optional `ageScreen` on email sign-up and Google sign-in is recorded through the same logic.
- The account response, `/v1/meta` and the export include the age state.
- `AGE_ENFORCEMENT` is `record` by default; `enforce` is refused by configuration, and only the `adult` band can be enabled.
- No client asks the question yet (no UI). Accounts created without the screen, including direct Supabase Auth sign-ups that bypass the API, stay `unknown`.

Every finding below still holds unless marked otherwise. **HealthMate still has no age gate:** recording a band does not block, route or protect any age group. Verified:

1. `POST /v1/auth/register` (`auth.controller.ts` `RegisterBody`) accepts an optional `ageScreen` (since 2026-10-02) and records it, but performs no age check and refuses nobody.
2. `POST /v1/auth/oauth` (Google) creates accounts on first sign-in with no age check (`identity.ts` `signInWithIdToken`). An optional `ageScreen` is recorded after the token is verified; nothing is refused by age.
3. `profiles.date_of_birth` is optional. `PATCH /v1/me` accepts any valid date (`profile.controller.ts` `day`), including dates showing the user is under 13 or under 18, and nothing reacts to it: editing it does not change the recorded age band (deliberately, so an edit can't silently upgrade a band). **Entering a child's DOB can give HealthMate "actual knowledge" under COPPA** (Checklist §6.1.3), yet no code acts on it. The same is true of an `under_13` band recorded through `POST /v1/me/age`: it is stored as `blocked_under_13` but **not acted on** (no block, no deletion).
4. No age gate, age checkbox or "18+" text exists in the web sign-up (`apps/web/src/app/sign-in`, `onboarding`) or the iOS onboarding (`OnboardingView.swift`, `SignInView.swift`, `AccountSetupView.swift`). A search for "18", "adult" and "years old" across clients, API and docs found nothing relevant.
5. The iOS app does not use Apple's Declared Age Range API. The App Store age rating is not in the repository **[FACT?]**.
6. Database constraints keep the age state consistent (valid values; `unknown` only before any assessment), but nothing enforces an age *rule*.
7. **No parent, guardian, child or dependent concept exists.** A search of the API, migrations, web, iOS and safety package for "parent", "guardian", "child", "minor" and "teen" found no such data model or flow. Accounts are single-user; there is no verifiable parental consent, parent dashboard, or parent export or deletion.
8. **No age-aware behaviour.** The AI prompts (`chat.prompts.ts`, `document.prompts.ts`) assume an adult reader. The deterministic triage rules (`packages/safety/src/rules.ts`) are marked **"PENDING CLINICAL REVIEW"** and contain no pediatric rules.
9. ~~The exact DOB goes to the AI provider~~ **Fixed 2026-10-02:** the profile summary carries only `Age: N years` (`profile.service.ts` `contextSummary`, §4.2; regression tests in `test/dob-exposure.test.ts`). An age in years still tells the provider that a user is a minor; whole years are kept (not a band) because general health information depends on age (screening ages, typical ranges).
10. Consents (`consents` table) are given by the account holder only. No field records *who* consented (the user or a parent) or for which age group.

A working age screen, with handling for the age groups chosen at launch, is a **launch blocker for every option** (Checklist §6.1, §6.8).

### 8.1 What each data flow means if a minor uses HealthMate today

| Flow (§4) | If the user is a minor, today | Assessment |
|---|---|---|
| Chat | Messages, age in years, conditions, medications and Apple Health summaries go to the AI provider (if configured) with adult prompts | Not safe to enable for minors (Checklist §6.5) |
| Reports | The whole document, with the child's identifiers, goes to the AI provider; stored indefinitely | Not safe to enable |
| Photos | Photo of the child uploaded, stored and sent to the AI **before** the model marks it unsupported | Not safe to enable — highest risk |
| Apple Health | Synced with `health_data_sync` consent; summaries reach the AI under `ai_processing` | Not safe to enable |
| Memory | Indefinite; includes AI inferences | Not safe to enable |
| Deletion/export | The account holder only; no parent rights | Does not meet COPPA parent rights |

See the Checklist, **§6.8 "Minors: Launch Blockers and Required Safeguards"**.

## 9. Public statements already in the product (representations)

The product already makes these statements. Each must be true at launch or be removed: they are representations the FTC can enforce. **The UI was not changed in this audit.**

| Statement | Location | Accuracy against code |
|---|---|---|
| "We never sell health data." | `apps/web/src/app/help/page.tsx` | True of the code (no sale path). It remains a binding promise. |
| "Your data is never sold or used for advertising." | `apps/ios/.../SettingsView.swift:62` | True of the code (no ad SDKs) |
| "Turning a switch off stops new processing right away." | Same | Queued work is now stopped (§4.2, fixed 2026-10-02). A call already in flight to the AI provider can't be recalled; its result is discarded. Counsel to confirm the wording is accurate enough. |
| "Audio is transcribed and not kept." / "Audio isn't stored." | `AccountSetupView.swift:189`; `project.yml` `NSMicrophoneUsageDescription` | HealthMate does not store audio. Apple may process it server-side when on-device recognition is unavailable — **[COUNSEL]** whether to disclose. |
| "It isn't sent to HealthMate." (location) | `project.yml` `NSLocationWhenInUseUsageDescription` | True. It is sent to Apple MapKit. |
| "You'll be able to export, correct and delete it." | `help/page.tsx` | Export, correction and deletion exist, with the gaps listed in §6 |
| "By continuing you agree to our Terms and Privacy Policy" | `apps/web/src/app/page.tsx`; `OnboardingView.swift`; `SignInView.swift` | **[GAP]** Neither document exists. iOS links point to `https://healthmate.example/terms` and `/privacy` (`AppServices.swift` `AppLinks`). Web links point to `/help#terms` ("will be published before launch"). Acceptance is not recorded anywhere (no table or field). |
| "HealthMate is not a substitute for a doctor" / disclaimers | Various | Consistent with the product rules |

## 10. Gap register (summary)

| # | Gap | Severity for launch | Section |
|---|---|---|---|
| G1 | No age-based controls (no age gate in any client, no app-store signal handling, no parental consent, no parent accounts). Since 2026-10-02 the backend can *record* a self-declared age band (recording only). | **Blocker** for every launch option; minors need more (Checklist §6.8) | §8 |
| G2 | Terms, Privacy Policy and Consumer Health Data Privacy Policy do not exist; links are placeholders; acceptance is not recorded | **Blocker** | §9 |
| G3 | AI provider not named in consent; iOS onboarding consent omits external sharing; no separate collection vs. sharing consent | **Blocker** (Apple 5.1.2(i); state health-data laws) | §4.2 |
| G4 | HealthKit-derived data sent to the AI provider without HealthKit-specific disclosure or permission | **Blocker** for an App Store build with HealthKit plus AI | §4.2 |
| G5 | AI provider contract, retention and training terms not reviewed; no BAA/DPA analysis | **Blocker** before real health data is sent to any external AI | §3 |
| G6 | ~~Consent withdrawal does not stop queued document jobs~~ **Fixed 2026-10-02** (execution-time checks). Remaining: in-flight provider calls can't be recalled. | Resolved; limitation documented | §4.2 |
| G7 | ~~Error logs can contain row values (health data)~~ **Database errors fixed 2026-10-02**: only SQLSTATE, table and constraint are logged. Other unexpected errors still log message and stack | Medium | §7 |
| G8 | No breach and incident response procedure, security contact or support contact | **Blocker** (FTC HBNR readiness; state laws) | §7 |
| G9 | Post-deletion residue (audit UUIDs, safety events, usage rows, backups, device data) undefined | High | §6 |
| G10 | Export lacks original files and the list of third-party recipients | Medium–High | §6 |
| G11 | Web preview mode on by default; public `/preview/inbox` | High (deployment) | §7 |
| G12 | No App Store privacy manifest (`PrivacyInfo.xcprivacy`) found; no App Privacy "nutrition label" inventory | High (App Store) | — |
| G13 | Retention periods undecided (health data indefinite; operational defaults are placeholders) | High | §5 |
| G14 | ~~Exact DOB sent to the AI~~ **Fixed 2026-10-02**: age in whole years only. Remaining: DOBs printed on uploaded reports (G15) or typed by the user into chat or memories are not redacted | Low | §4.2 |
| G15 | Report/photo files sent to the AI unredacted (identifiers on documents) | Medium–High | §4.2 |
| G16 | MapKit search reveals care-seeking intent plus location to Apple; not disclosed | Medium | §3 |
| G17 | Regulatory status of symptom triage, image "possible causes" and report flags is unassessed (FDA) | **Blocker** for the image and report features until assessed | Checklist §4 |
| G18 | No child- or teen-specific safeguards (age-aware AI, pediatric triage, feature gating, minors' retention, parent rights) | **Blocker** for enabling any user under 18 | §8, §8.1 |
| G19 | Consent records don't say who consented (user vs. parent) or the age group | **Blocker** for minors | §8 |

## 11. Method and limits

- **Inspected:** API modules, migrations 0001–0014, RLS/storage policies, AI providers, gateway, logging calls, clients' consent and legal copy, HealthKit service, iOS entitlements and usage strings, and dependency manifests.
- **Not inspected:** any production deployment, the Supabase dashboard settings, the hosting configuration, App Store Connect settings, and third-party contracts.
- **Tests:** none were changed. The existing suite was run on this commit (see the commit message and final report).
- **Re-run this audit** whenever a provider, SDK, data field, route or retention setting changes.
