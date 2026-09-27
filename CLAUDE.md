# HealthMate — rules for contributors (humans and AI agents)

HealthMate is an **AI health companion**, not a doctor. These rules are not optional.

## Medical safety
- Never present AI output as a diagnosis. AI content is labelled "AI-generated" and shows what it was based on.
- Never invent medical history, test results, medications, doses or clinician instructions — not even in sample data.
- Never add an action that changes a medication or dose without explicit product approval and safety review.
- Never treat AI inference as confirmed medical history (`ai_inferred` ≠ `user_confirmed`).
- Metric context compares against the user's own baseline ("In your usual range"). Do not use "normal", "healthy" or "abnormal" in UI copy.
- Urgent/warning content must be visually distinct and never hidden below decorative UI.
- Use "AI Health Assistant", not "AI Doctor".

## Data & privacy
- Never expose health data across user boundaries. All health API routes require authorization checks.
- Never put model/provider API keys in iOS or web code. AI calls go through the backend AI Gateway.
- Sample data must be tagged `source: "sample"` and the UI must show the demo-mode notice.
- Minimize health content in logs.

## Architecture
- Design tokens: edit `packages/design-tokens/tokens.json`, then `npm run tokens`. Never hand-edit generated files.
- Domain types: `packages/shared-types` (TS) and `apps/ios/Packages/HealthMateCore` (Swift) must stay in sync.
- UI depends on service interfaces (`HealthMateClient`, `HealthDataService`), never on a concrete backend.
- Business logic lives in view models / pure modules, not in views.
- Respect Reduce Motion in every animation.

## Before pushing
- `npm test` (tokens check + unit tests), `npm run typecheck`, `npm run lint`, `npm run test:e2e`.
- iOS: `swift test` in `apps/ios/Packages/HealthMateCore`; `xcodegen generate` then build/test in Xcode.
- All safety behaviour needs automated tests.
