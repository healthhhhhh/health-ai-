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
      PostgreSQL + pgvector · Redis/BullMQ · S3-compatible object storage
```

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
4. **Structured answer** (JSON schema) from the AI gateway.
5. **Review** of the answer (overconfident diagnosis, dosing directions). Failing answers are
   regenerated once, then replaced with a safe fallback.
6. Medication-change requests always get the fixed "talk to your prescriber" notice.

Uploaded documents and photos are untrusted input: the server checks file signatures, the AI is
told to ignore embedded instructions, and detected injection attempts are flagged in the result.

## API (services/api)

- `npm run api:dev` runs it on `http://localhost:4000` with an embedded in-memory PGlite database.
  Set `PGLITE_DIR` to keep data between restarts, or `DATABASE_URL` for PostgreSQL. Set
  `JWT_SECRET` (32+ characters) too, or sessions reset on every restart. Migrations are applied at
  start-up (`services/api/migrations`).
- `ANTHROPIC_API_KEY` enables the AI features. Without it `/v1/meta` reports `ai.available: false` and
  AI routes return `ai_unavailable`. The apps show this state; nothing is faked.
- Access tokens last 15 minutes. Refresh tokens rotate, and reusing one revokes its whole family.
- Every health route requires a bearer token and filters by the caller's user ID. Rate limits
  cover auth, chat and uploads. Audit logs record actions, never health content.

## Client data layer

Both clients depend on an interface, never on a concrete backend:

| | Interface | Sample-data impl | Backend impl |
|---|---|---|---|
| Web | `HealthMateClient` (`src/lib/data/client.ts`) | `MockHealthMateClient` | `HttpHealthMateClient` |
| iOS | `HealthDataService` (`HealthMateCore/Services`) | `MockHealthDataService` (actor) | `HTTPHealthDataService` |

Selection is configuration, not code: `NEXT_PUBLIC_DATA_SOURCE=mock|api` (web) and
`HM_DATA_SOURCE` build setting (iOS, `project.yml`). Every sample record is tagged
`source: "sample"` and both apps show a *Demo mode* notice while using it.

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
No model keys in clients; auth tokens in Keychain (iOS) / httpOnly cookies (web); server-side
authorization on every health route; signed URLs for uploads; audit logs without health content.
