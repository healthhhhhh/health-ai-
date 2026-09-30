# Roadmap & status

"Written" means the code is in the repository. "Verified" means CI compiled it and its tests passed.

| Phase | Scope | Status |
|---|---|---|
| 1 | Design system, navigation, app shells | ✅ Web + iOS verified in CI |
| 2 | Onboarding + authentication | 🟡 API: register/login/refresh (rotating, reuse detection)/logout, argon2id. iOS: sign-in/create account, Keychain session |
| 3 | Home dashboard | ✅ Web · iOS (sample data, labelled) |
| 4 | AI chat | 🟡 API: AI gateway, triage before model, structured answers, response safety review, consent gate. iOS: chat screen, follow-up chips, escalation cards, history, memory suggestions |
| 5 | Health dashboard + timeline | 🟡 iOS: Apple Health trends (Swift Charts) vs own baseline, optional sync. API: measurements, trends, timeline |
| 6 | Reports / document upload | 🟡 API: signed uploads, type sniffing, AI extraction as untrusted input. iOS: upload, results, questions for your doctor |
| 7 | Plans / tasks / reminders | ✅ iOS My Plan: tasks, medications (verbatim clinician instructions), habits, week view, on-device storage, private local reminders |
| 8 | Image analysis | 🟡 API + iOS: quality check, observations, possible causes (not diagnoses), warning signs |
| 9 | Voice | 🟡 iOS: on-device speech-to-text with an editable transcript |
| 10 | HealthKit | 🟡 iOS: read-only steps, heart rate, resting HR, sleep, active energy, weight |
| 11 | Web dashboard (health, reports pages) | ⬜ Parked (iOS first) |
| 12 | Production hardening | ⬜ See "Before launch" |

🟡 = built and unit-tested in CI (iOS build, HealthMateCore + app tests, API tests against an embedded database), but not yet exercised end to end with a live AI provider key or on a device with real Apple Health data.

## Before launch (decisions and work outside the codebase)

- **Clinical review** of `packages/safety/src/rules.ts` (triage rules and escalation copy).
- **AI provider key** (optional until launch): set `ANTHROPIC_API_KEY` on the server. Without it the assistant says it's unavailable; it never makes up an answer. Development runs without a key (`AI_PROVIDER=development`: offline scripted answers, labelled as demo).
- **Apple Developer Program** (paid): needed for Sign in with Apple and real push delivery (APNs). Everything else runs on a free Apple ID; steps in `docs/phase2d-plan.md` §3.
- **Google sign-in** (server implemented, free): create OAuth client IDs, set `GOOGLE_CLIENT_IDS`, then add Google Sign-In to the apps (`docs/phase2d-plan.md` §1).
- **Supabase** (implemented — see `docs/backend-supabase-migration.md`): allow the build environment to reach the project, rotate the secret key that was shared in chat, turn on email confirmation + custom SMTP, deploy the `embed` function, and run `SUPABASE_LIVE_TEST=1` against a staging project. Set `HM_API_BASE_URL` for iOS release builds.
- **Redis** (implemented): provision a managed Redis for shared rate limits and BullMQ, and run `npm run worker`.
- **Compliance**: Supabase HIPAA add-on / BAA or regional equivalent, and a DPA, before storing real health data.
- **Uploads**: malware scanning before files are processed.
- **Legal**: Terms and Privacy Policy URLs (placeholders in `AppLinks`), and a regional crisis-line directory review.
