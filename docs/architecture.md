# Architecture

HealthMate ships a native iOS app and a web app on **one shared backend and data model**
(spec: `docs/AI_Health_Companion_Specification.pdf`, §5–8).

```
 iOS (Swift · SwiftUI)          Web (Next.js · TypeScript)
          │                                 │
          └──────── HTTPS / REST (v1) ──────┘
                          │
              NestJS API (services/api)
      auth · profile · conversations · memory · documents ·
      images · plans · reminders · health data · care
                          │
                     AI Gateway  ── model routing, context & memory retrieval,
                          │         prompt management, safety checks, vision,
                          │         documents, speech, usage & cost tracking
                          │
   Supabase: Postgres (RLS, pgvector) · Auth · Storage (private buckets)
             · Edge Function `embed` (gte-small)      Redis: rate limits · BullMQ jobs
```

Adapters keep the business logic independent of the infrastructure: identity (local | Supabase
Auth), object storage (local disk | Supabase Storage), embeddings (Supabase | dev hash | none),
job queue (in-process | BullMQ), rate-limit store (memory | Redis) — chosen by configuration in
`services/api/src/adapters.ts`. Details and rationale: [`backend-supabase-migration.md`](backend-supabase-migration.md).

## Repository layout

| Path | What |
|---|---|
| `packages/design-tokens` | `tokens.json` — **single source of truth** for colour, radius, spacing, type, shadow. `npm run tokens` generates `apps/web/src/styles/tokens.css` and `apps/ios/.../DesignTokens.swift`; CI fails if they are stale. |
| `packages/shared-types` | TypeScript domain model = the API contract. Mirrored in Swift in `HealthMateCore/Models`. Later: generate both from the backend's OpenAPI schema. |
| `apps/web` | Next.js 16 App Router, Tailwind CSS v4, in-house component library (`src/components/ui`, shadcn-style: cva + tailwind-merge, no runtime UI dependency). |
| `apps/ios` | SwiftUI app (iOS 17+), XcodeGen project spec, `HealthMateCore` Swift package. |
| `packages/safety` | Deterministic safety checks: symptom triage rules, escalation copy, medication-change detection, prompt-injection detection, review of AI answers. `npm run safety:export` generates the Swift copy of the rules; CI fails if it is stale. |
| `services/api` | NestJS API: auth, health profile, consents, data export/deletion, AI gateway, chat, memory, documents and image analysis, health data, timeline. |
| `docs/` | Spec, UI reference image, this document, design system, roadmap. |

The iOS app lives beside the TypeScript workspace rather than inside a JS framework (spec §18).

## Safety pipeline (chat)

1. **On-device triage** (iOS `SafetyEngine`, same rules as the server): emergency guidance appears
   instantly, even when signed out or offline.
2. **Server triage** before any model call. Emergencies get a fixed escalation message and the model
   is **not** called. Urgent cases always carry an "urgent" care recommendation.
3. **Context**: profile, conditions, allergies, medications (verbatim) and confirmed memories. AI
   inferences are never stored as confirmed history; the person confirms memory suggestions.
4. **Structured answer** (JSON schema) from the AI gateway — task `health_chat`, or `complex_health`
   for urgent symptoms and medication questions.
5. **Validation** by the gateway: schema first, then content (overconfident diagnosis, dosing
   directions). Failing answers are regenerated once, then replaced with a safe fallback.
6. Medication-change requests always get the fixed "talk to your prescriber" notice.

Uploaded documents and photos are untrusted input: the server checks file signatures, the AI is
told to ignore embedded instructions, and detected injection attempts are flagged in the result.

## AI Gateway (services/api/src/modules/ai)

Features never call an AI provider: they ask `AiGateway.generate({ task, userId, system, messages,
schema, safetyCritical? })`, the single entry point (enforced by an architecture test).

```
feature ──► AiGateway ──► route (AI_ROUTES / AI_PROVIDER) ──► cost check ──► AiProvider.generate
                │                                                               │
                ◄── schema validation ◄── content validation ◄──────────────────┘
                └── ai_usage row (task, provider, model, period, tokens, estimated + priced cost, status)
```

- **Tasks**: `health_chat`, `complex_health`, `report_analysis`, `image_analysis`,
  `task_generation`, `summarization` (`ai.tasks.ts`: effort, output limits, validators, and the
  output contracts for the last two).
- **Providers** implement `AiProvider` (`ai.types.ts`): `anthropic`, `development` (offline, free),
  `demo`, `unavailable`. They only generate; keys stay inside them, server-side. Adding Gemini or
  OpenAI = one class implementing `generate()`, one case in `adapters.ts`, one provider name in
  `ai.routing.ts`, and prices in `ai.pricing.ts` / `AI_PRICES`. Nothing else changes.
- **Routing**: `AI_PROVIDER` serves every task; `AI_ROUTES` overrides per task
  (`complex_health=anthropic:claude-opus-5-5@high`).
- **Pricing** (`ai.pricing.ts`): Anthropic list prices per model (input, output, cache read, 5-minute
  cache write), with their source and effective date (`PRICES_EFFECTIVE_DATE`); override with
  `AI_PRICES`. Images, PDFs and thinking are billed as input/output tokens, so they have no separate
  price. **Fail closed**: a paid model without a price stops the server at startup (for routed
  models) or refuses the request; an unpriced model that answers anyway (a refusal fallback) is charged
  the reserved worst case. A fallback that runs several models is priced model by model from
  `usage.iterations`.
- **Cost protection — atomic reservations** (`ai.budget.ts`, migration `0013`): before a paid
  call the gateway reserves the request's worst case (estimated input × 1.5 at the higher of the input
  and cache-write prices, plus the full output allowance) in `ai_budget_periods` with one conditional
  `UPDATE` (`spent + reserved + amount ≤ limit`). Postgres row-locks the ledger row, so concurrent
  requests serialize and can't jointly pass `AI_MONTHLY_USER_BUDGET_USD` (default $5, UTC month).
  After the call the reservation is **settled** at the priced reported usage (or the provider's
  billed amount) in the same transaction as its `ai_usage` row; **released** when the provider
  didn't process the request (HTTP error status); kept at the **worst case** when usage is unknown
  (timeout after `AI_REQUEST_TIMEOUT_MS`, dropped connection, missing usage metadata). Settling acts
  only on a held reservation, so retries and late duplicates can't charge twice. Reservations
  abandoned by a crashed process expire and are charged in full (checked before every reservation
  and by the maintenance loop). People see only "AI unavailable" — never balances or credits.
  - **Real usage always counts.** Settling adds the full reported cost to the month's spend, even when
    it exceeds the reservation (e.g. a refusal fallback answered with a pricier model, priced model by
    model). Spend above the limit then refuses further routine requests.
  - **Late answers.** A request charged at its reservation because its usage was unknown (timeout,
    expiry) is reconciled once when its real usage arrives: the charge can only go up, never down, and
    a second reconciliation is a no-op. Requests settled from reported usage are never reopened.
  - **Malformed usage** (missing, negative, non-finite counts, a broken per-model breakdown, an
    invalid billed amount) is charged at least the reserved worst case.
  - **Safety-critical requests** (urgent symptoms) may use `AI_SAFETY_CRITICAL_ALLOWANCE_USD`
    (default $5) on top of the limit — accounted like everything else, but capped, so urgent-sounding
    messages can't be used for unlimited model use. Past that allowance, or whenever the model can't
    answer an urgent message (AI down, declined, unusable output), chat returns the deterministic urgent
    escalation from `packages/safety` instead of an error. Emergencies never reach a model at all.
    Medication questions use `complex_health` and the normal safety checks; they are not emergencies
    and the limit applies to them.
  - **Near the limit (deliberate trade-off).** A request is refused when its *worst-case* reservation
    doesn't fit in the remaining budget, even if its real cost would have. At Opus 5.5 prices a routine
    chat reserves about $0.33 (full output allowance, which also caps thinking), so roughly the last
    $0.33 of the $5 month is unusable for routine chat. This is kept on purpose: reserving less would
    let concurrent requests overrun the limit. Lowering a task's `maxOutputTokens` or routing it to a
    cheaper model is the safe way to shrink this margin.
- **Consent at execution time** (`ProcessingPolicy`, `modules/account/processing-policy.ts`):
  every piece of server-side processing is checked against the person's *latest* consent when it
  runs, not only when it was requested.
  - **AI**: the purpose comes from the task (`TASK_PURPOSE`: chat → `ai_processing`, report/photo →
    `document_processing`), never from a request. `AiGateway.generate` checks it first: refused work
    reserves nothing, records no usage and never reaches a provider.
  - **Report and photo jobs**: withdrawing `document_processing` marks queued and running analyses as
    stopped ("permission … was withdrawn") in the same transaction. The worker re-checks before reading
    the file, the gateway checks again, and the result is stored only if permission still holds when
    it's saved. Consent changes and these saves serialise on a per-person advisory lock, so either the
    save commits first (the result is kept) or the withdrawal does (nothing is stored).
  - **Memory embeddings** run only while `ai_processing` is granted; granting it again queues the ones
    that were skipped. **Apple Health writes** re-check `health_data_sync` inside their transaction.
  - **Limit:** a request already handed to an AI provider can't be recalled. A withdrawal during that
    window discards the result (and its cost is still accounted); it can't stop the provider receiving
    the request. Urgent chat messages fall back to the deterministic escalation if consent disappears
    mid-request; emergencies never use a model.
- **Accounting**: `ai_usage` (server-only, no health content) keeps user, billing period, task,
  provider, requested and serving model, input/output/cache tokens, estimated and charged cost, the
  cost basis (`usage`, `reservation` or `none`), price version, status (`ok`, `flagged`,
  `invalid_output`, `declined`, `unavailable`, `budget_exceeded`, `timeout`, `expired`, `unpriced`,
  `error`), the reservation it settled (unique) and whether it was safety-critical. User id, task,
  model, period and cost are always set by the server, never from a request body.

## API (services/api)

- `npm run api:dev` runs it on `http://localhost:4000`; with no configuration it uses an embedded
  PGlite database (with pgvector and local stand-ins for Supabase's `auth`/`storage` schemas), local
  files, local accounts and in-process jobs. `.env` at the repo root configures Supabase, Redis and
  the AI key (see `.env.example`).
- Migrations: `services/api/migrations` (mirrored to `supabase/migrations`). Production applies them
  in the deploy step (`npm run db:migrate`), not at start-up.
- `ANTHROPIC_API_KEY` enables the AI features. Without it `/v1/meta` reports `ai.available: false` and
  AI routes return `ai_unavailable`. The apps show this state; nothing is faked. For development
  without a key, `AI_PROVIDER=development` gives offline scripted answers (`ai.demo: true`, so the
  apps show their demo notice) that list the context retrieval selected; refused in production.
- Every route except `auth/*` requires a session; every query filters by the caller's user ID, and
  Postgres Row Level Security enforces the same isolation independently. Every route is
  rate-limited. Audit logs record actions, never health content.
- `npm run worker` processes reports/photos and embeddings from Redis and runs housekeeping.

## Client data layer

Both clients depend on an interface, never on a concrete backend:

| | Interface | Sample-data impl | Backend impl |
|---|---|---|---|
| Web | server-only API layer (`src/lib/api/server.ts`, `data.ts`) | the API's demo server (`npm run demo -w @healthmate/api`, labelled) | the HealthMate API |
| iOS | `HealthDataService` (`HealthMateCore/Services`) | `MockHealthDataService` (actor) | `HTTPHealthDataService` |

Selection is configuration, not code: `HEALTHMATE_API_URL` (web, server-side only) and the
`HM_DATA_SOURCE` build setting (iOS, `project.yml`). Every sample record is tagged
`source: "sample"` and both apps show a *Demo mode* notice while using it (the API reports
`ai.demo` in `/v1/meta`).

Web mutations (task completion, mood check-in) go through **Next.js server actions** that call the
data client and revalidate the page, so state survives navigation and reload; the UI updates
optimistically and rolls back with an inline error if the call fails. iOS does the same in
`HomeViewModel` (optimistic update → rollback + toast).

## Decisions

1. **Tokens generated from one JSON file** — the two platforms cannot drift visually.
2. **Accessible colour values** — the reference image's green/orange/blue text colours fail WCAG AA on
   white; tokens keep the same hues but darker steps (verified with axe in e2e).
3. **Own component library instead of shadcn CLI** — same pattern (cva variants, `cn()`), no generated
   code to maintain, and it matches the reference rather than shadcn's default look.
4. **XcodeGen** — the `.xcodeproj` is generated (git-ignored), so project-file merge conflicts disappear.
5. **`HealthMateCore` is pure Foundation** — models, services, formatting and presentation rules are
   testable with `swift test` without a simulator. Views stay thin.
6. **Dynamic Type everywhere on iOS** — fonts map to text styles, not fixed point sizes.
7. **"Daily Progress" instead of the reference's "Health Score"** — a single score would imply a clinical
   assessment the app cannot make. The ring shows progress on goals the user set.
8. **"AI Health Assistant", never "AI Doctor"** — the reference's search placeholder was reworded.
9. **Mascot is an original vector companion, not a clinician** — replaceable: `illustrations.mascot.src`
   (web) or an asset named `Mascot` (iOS).
10. **Motion respects Reduce Motion** — CSS media query on web, `accessibilityReduceMotion` on iOS.

## Security baseline
No model keys, Supabase secret key or database URL in clients; auth tokens in Keychain (iOS) /
httpOnly cookies (web); server-side authorization on every health route plus RLS on every table;
private buckets with short-lived signed URLs for uploads and downloads; audit logs without health
content.
