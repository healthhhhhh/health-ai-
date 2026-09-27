# HealthMate — your AI health companion

HealthMate helps people understand health information, track their health, make sense of medical
reports and keep up with clinician-provided instructions, with an AI Health Assistant.
**It is not a doctor and does not diagnose.**

Monorepo: native iOS app (Swift/SwiftUI) + web app (Next.js/TypeScript) sharing one design system
and data model. See [`docs/architecture.md`](docs/architecture.md), [`docs/design-system.md`](docs/design-system.md),
[`docs/roadmap.md`](docs/roadmap.md) and the rules in [`CLAUDE.md`](CLAUDE.md).

## Web
```bash
npm install
npm run dev            # http://localhost:3000
npm test               # tokens check + unit/component tests
npm run typecheck && npm run lint
npm run build && npm run test:e2e   # Playwright: desktop, tablet, phone + axe accessibility
```
Runs on sample data by default (`apps/web/.env.example`).

## iOS (macOS + Xcode 16)
```bash
brew install xcodegen
cd apps/ios && xcodegen generate && open HealthMate.xcodeproj
cd apps/ios/Packages/HealthMateCore && swift test
```
Requires iOS 17+. See [`apps/ios/README.md`](apps/ios/README.md).

## Design tokens
Edit `packages/design-tokens/tokens.json`, then `npm run tokens` to regenerate web CSS and Swift.
