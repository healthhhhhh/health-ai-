# Architecture

HealthMate ships a native iOS app and a web app on **one shared backend and data model**
(spec: `docs/AI_Health_Companion_Specification.pdf`, §5–8).

```
 iOS (Swift · SwiftUI)          Web (Next.js · TypeScript)
          │                                 │
          └──────── HTTPS / REST (v1) ──────┘
                          │
              NestJS API (planned — Phase 2+)
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
| `docs/` | Spec, UI reference image, this document, design system, roadmap. |

The iOS app lives beside the TypeScript workspace rather than inside a JS framework (spec §18).
`services/` (NestJS API, AI gateway, workers) and `infrastructure/` are added from Phase 2.

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

## Security baseline (applies from Phase 2)
No model keys in clients; auth tokens in Keychain (iOS) / httpOnly cookies (web); server-side
authorization on every health route; signed URLs for uploads; audit logs without health content.
