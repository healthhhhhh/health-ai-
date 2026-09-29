# Phase 1 (UI/UX only): audit and completion plan

Audited on 2026-09-29 at commit `118e952`. Scope: `apps/ios` (SwiftUI) and `apps/web` (Next.js).

**Important context.** The repository already contains a working backend (NestJS + Supabase,
the AI Gateway, report/photo analysis, HealthKit sync). Phase 1 does **not** remove or extend
it. Instead, Phase 1 adds a **Preview mode** to both apps. In Preview mode every screen and
state runs on local, clearly labelled sample data, through the same service interfaces the live
backend uses. Phase 2 then only has to switch the data source; no screen needs redesigning.
Sample AI content is always marked "Sample response — not real AI". It is never presented as a
real assessment.

## Progress

| Step | Status | Notes |
|---|---|---|
| 0 · Preview mode foundation | ✅ Done | See below |
| 1 · Design system components | ✅ Done | See below |
| 2 · Auth & onboarding | ✅ Done (iOS app build confirmed by CI) | See below |
| 3 · Home & notifications | ⏳ Next | |
| 4–12 | ⬜ Not started | |

### Step 2: what was built

Sign-up → confirm email → account setup → Home now works end to end in Preview mode on both platforms.
- **Sign in / create account:** Continue with Apple and Continue with Google. In Preview mode these sign in to
  a new sample account; real OAuth is Phase 2. Signed-out and account-deleted notices.
- **Email verification:** a "Check your email" screen (web `/verify-email`, iOS inside the sign-in sheet) with:
  - resend, with a 30-second cooldown
  - use a different email
  - the Preview inbox
  - states for an expired link and a failed confirmation
  Signing in before confirming returns to this screen instead of showing an error.
- **Account setup** (web `/onboarding`, iOS `AccountSetupView`), in six steps:
  1. About you. Only a first name is required.
  2. Goals.
  3. Optional health details. These are saved as "you added" (`user_reported`), and medication instructions are kept word for word.
  4. Privacy consents. All start off.
  5. Reminders, with the notification permission primer.
  6. The Apple Health primer.
  A summary follows; nothing is saved until the last step. The app routes accounts that haven't finished setup here (`me/account.onboardingCompleted`).
- **Welcome (iOS):**
  - "Get Started" now opens Create account.
  - "Explore without an account" keeps the signed-out, on-device plan.
- **Sign out:** a confirmation dialog on web (iOS already had one), then the sign-in screen.
- **Shared logic:** in HealthMateCore (`HealthGoal`, `AccountSetupStep`, `AccountSetupDraft`: validation and save), with tests.
- **Found and fixed:**
  - Both Preview routers returned the whole health profile from `PATCH me/profile`; they now return just the profile details, as the real API does.
  - Onboarding now saves reminder choices to `me/notification-preferences`.
  - The CI embeddings check now waits for an authenticated 200 before it runs.
- **Verification:**
  - web unit 67/67
  - web e2e 83/83, including the full sign-up → onboarding → sign-out flow, social sign-in, and axe on every onboarding step and the verify-email states
  - iOS core 88/88
  - new iOS UI test: sign-up → setup → Home

### Step 1: what was built

Shared components, the same names and behaviour on both platforms (web `components/ui`, iOS
`DesignSystem/Components`). Copy for states, provenance and notification categories lives in
HealthMateCore so iOS and web say the same thing:
- **States:** `StateView` (loading, processing, empty, error, offline, permission, success), skeletons (`Skeleton*` / `.hmSkeleton`), `StepProgress`.
- **Feedback:** toasts (`ToastProvider`/`useToast`, iOS `ToastCenter` + `.hmToasts`), `ConfirmDialog` (iOS: native confirmation dialogs), `Sheet`.
- **Controls:** `Switch`, `Textarea` with a counter, `Select`, `FilterChips`, and a destructive button style.
- **Rows and labels:** `ListRow`/`ListGroup`, `SourceBadge` (provenance; AI inferences always "Unconfirmed"), `AIGeneratedLabel`, `SampleContentLabel`.
- **Permissions:** `PermissionPrimer` (prompt, granted, denied with how to re-enable, unavailable).
- **Domain cards:** `AppointmentCard`, `ProviderCard`, `NotificationRow`, `MedicationCard` (instruction verbatim, 7-day adherence). These join the existing metric, task, report and timeline components.
- **Galleries:** web `/design` (linked from Settings) and iOS Profile › Design system.
- **Accessibility fixes found by the new checks:**
  - The error fill (used by the emergency Call button on iOS) was 4.13:1. It is now `#D1392E`, 4.84:1.
  - The selected filter-chip count was below the contrast minimum; restyled.
- **Verification:** web unit 66/66; web e2e 77/77 (gallery interactions and axe); iOS core 84/84.

### Step 0: what was built

- **One sample dataset** (`packages/sample-data`): "Alex Morgan", 60 days of wellness data, plan and
  3 weeks of completions, conversations, reports and photos, timeline, symptoms, care team,
  appointments, notifications and HealthKit connection. It is time-zone aware (morning medication is
  in the morning wherever you are). Clinical fields stay generic per CLAUDE.md ("Morning
  medication — as prescribed", "Example marker A"), and every AI text is labelled a sample response.
  iOS gets a generated JSON copy (`npm run sample:export`, checked in `npm test`).
- **Preview API at the network boundary, on both platforms.** It serves the same REST paths and
  shapes as `services/api`, so screens don't know the difference and Phase 2 is a switch:
  - Web: `lib/preview/router.ts`, answered inside the Next.js server (`HEALTHMATE_DATA_SOURCE=preview`, the default).
  - iOS: `PreviewBackend` + `PreviewURLProtocol` in HealthMateCore, on the device (`HM_DATA_SOURCE: preview`, the default).
  - Chat keeps the real safety order: deterministic triage → fixed emergency guidance → fixed sample reply. There is no AI.
  - Uploads produce a sample result a few seconds later, marked "Sample result".
- **Mocked auth**: email/password (any 8+ character password; `wrong-password` fails), sign-up with
  email confirmation, Continue with Google/Apple, forgot/reset password, logout and delete. The emails
  go to a **Preview inbox**.
- **Debug states**: Normal, Loading (3 s), Slow, Empty (new account), Server error, Offline,
  Permissions off. Web: the floating "Preview" panel. iOS: Profile › Preview mode.
- **New contracts** defined by Preview (served by the API in Phase 2): notifications and preferences,
  account summary and onboarding flag, OAuth, email verification, provider/appointment detail and
  edit, conversation rename.
- **Why not per-feature Swift protocols** (as first planned): intercepting at the network boundary gives
  the same guarantee — screens depend only on the API contract — with no screen changes and one
  implementation per platform. It is tested end to end through the app's real `APIClient`.
- **Verification:** web unit tests including 8 preview-router tests; **web e2e runs entirely in
  Preview mode (74/74, 3 viewports + axe), no server**; iOS core: 80/80 `swift test` on Linux
  including the Preview backend and the client going through `PreviewURLProtocol`. The iOS app
  target (SwiftUI) needs Xcode: build it on the Mac.

---

## 1. Screens already implemented (complete, both platforms unless noted)

| Screen | iOS | Web |
|---|---|---|
| Welcome / feature intro | `OnboardingView` (4 pages) | `/` |
| Sign in / create account | `SignInView` | `/sign-in` |
| Forgot / reset password | sheet in `SignInView` (request only) | `/forgot-password`, `/reset-password` |
| Home dashboard (greeting, AI hero, today's health, daily progress, plan, mood, activity, appointments) | `HomeView` | `/home` |
| AI Chat (conversation, follow-up chips, escalation cards, history) | `ChatView` + history sheet | `/chat` |
| Health dashboard (metric cards, 7/30-day trends) | `HealthDashboardView` + `MetricDetailView` | `/health` |
| Health timeline (list, add entry, delete) | `HealthTimelineView` | `/timeline` |
| Reports list, upload, result | `DocumentsView`, `DocumentDetailView` | `/reports`, `/reports/[id]` |
| My Plan (tasks, medications, habits, week strip, editor) | `PlanView`, `PlanItemEditor` | `/plans` |
| Profile (details, conditions, allergies, medications, health memory) | `ProfileView`, `MemoryListView` | `/profile` |
| Privacy & data (consents, export, delete account) | inside `ProfileView` | `/settings` |
| Find care (nearby, emergency, crisis) | `CareFinderView` (sheet) | `/care` |
| Help & legal | links only | `/help` |
| Voice input | `VoiceInputView` | — (not planned for web) |
| Design system gallery | `DesignSystemGallery` | — |

## 2. Screens partially implemented

| Screen | What's missing |
|---|---|
| **Onboarding** | Only 4 intro pages. No profile setup (name, goals, optional conditions), no consent step, no notification or Apple Health priming. Web has one welcome page. |
| **Image analysis** | iOS: a `PhotoCheckView` sheet inside Reports. Web: part of the Reports upload. There is no dedicated entry point, no capture guidance, and no quality-check retake flow or detail layout of its own. |
| **Medications** | They live in two places (Profile › Medications and Plan items of kind `medication`), with no medication detail, schedule/adherence view or refill-style information. Web: plan-only. |
| **Tasks** | They exist only as plan items. There is no "Tasks" list across days (overdue, upcoming, done). |
| **Doctor / Care** | Find-care only. No care team (providers), provider detail, appointments list/detail/add or edit. Home shows appointments as read-only, with nothing to tap. |
| **Settings (iOS)** | Mixed into Profile: one notifications toggle and privacy toggles. There is no Settings screen with notifications, units, appearance, privacy, data, about, account. |
| **HealthKit permission flow** | iOS has a "Connect" card, a disconnect confirmation and "not available". It lacks priming (why and which data), a denied/limited state that deep-links to Settings, per-type status and a sync status screen. The web has no "connect on iPhone" explainer. |
| **Password reset (iOS)** | Request only. Completion happens on the web by design; iOS has no "check your email" success screen. |
| **Metric detail** | iOS has it. The web has no metric detail page (the card only expands inline). |
| **Timeline** | No entry detail, filters (type/source/date), search or grouping by day with sticky headers. |
| **Chat** | No new-chat entry from history, no rename/delete in history (web), no attach report/photo entry point, no offline state, no "AI unavailable" illustration consistency, no message actions (copy, report a problem). |
| **Reports** | No filters or search. No processing progress steps, "unreadable file" state layout, original-file viewer (iOS opens in Safari) or "questions for your doctor" export/share. |

## 3. Screens missing

1. **Notification centre**: the iOS Home bell is a no-op, and the web has no bell at all.
2. **Notification settings** (per category: medication reminders, tasks, appointments, report ready; quiet hours; lock-screen privacy).
3. **Onboarding profile setup** (name, health goals, optional conditions/allergies/meds, "skip").
4. **Permission priming screens**: notifications, Apple Health, camera, microphone and location, each with a denied state.
5. **Care team**: provider list and provider detail.
6. **Appointments**: list (upcoming/past), detail, add/edit, "prepare questions" checklist.
7. **Medication detail**: instruction shown verbatim, schedule, adherence history, source.
8. **Tasks overview** (today/upcoming/overdue/completed).
9. **Image analysis hub**: purpose picker, photo guidance, retake flow, result.
10. **Settings (iOS)** as its own screen. On the web: notifications, units, appearance and about sections.
11. **Account screens**: edit profile, change email/password (UI), connected devices/sessions (UI).
12. **Timeline entry detail**.
13. **Web metric detail** (`/health/[metric]`).
14. **Offline / maintenance** full-screen states.
15. **Web "Get the iPhone app / connect Apple Health" explainer.**

## 4. Features currently using mock or demo data

| Feature | Source today |
|---|---|
| Home (iOS) | `HM_DATA_SOURCE=sample` → `MockHealthDataService`/`SampleData`, labelled. `live` = account + Apple Health. |
| Plan (iOS) | `SamplePlan` seeds a first-run example (labelled). Otherwise stored on-device plus account sync. |
| Everything else (both apps) | **Needs the live API.** For demos, `npm run demo -w @healthmate/api` runs the API with a scripted, labelled demo AI and a demo account. |
| Web | No mock mode: every page requires the API. |
| Mood (iOS) | Local `MoodStore` (plus account sync when signed in). |

Result: most screens can't be demonstrated without running a server. The signed-out iOS app
shows sign-in walls for Chat, Reports, Timeline and Profile.

## 5. Incomplete navigation paths

- iOS Home › bell leads nowhere. Web: no notifications entry.
- Home › "Upcoming appointments" rows aren't tappable (no appointment detail), and there's no "See all".
- iOS: Reports is reachable only via Profile › Reports & photos. There's no Home or Health shortcut and no image-analysis entry point.
- iOS: Timeline is reachable only from Health, and only when signed in.
- iOS: Find care is reachable only from chat escalations (no Profile/Home entry, no Care tab or section).
- Home › Today's health › a metric opens the Health tab, not that metric's detail.
- Recent activity rows (report, chat, image, appointment) don't open the item.
- Timeline entries don't open anything.
- Web: no metric detail route. Care has no providers/appointments. Onboarding stops at the welcome page.
- Web mobile: the bottom bar has 5 items. Reports, Care, Timeline and Settings are only in the drawer; that's fine, but the drawer lacks Notifications.

## 6. Missing states (by feature)

Legend: L loading · E empty · Er error/offline · S success · P permission · C confirmation.

| Feature | Missing |
|---|---|
| Onboarding | P (notifications, Apple Health priming + denied), S (setup complete) |
| Auth | S "check your email" (iOS reset, sign-up confirmation on iOS), Er offline layout, account-locked/rate-limited copy |
| Home | Er per-card (partial failure), E first-day state (no data anywhere), skeleton for every card (only some redact) |
| Chat | Er offline banner + retry per message, "AI unavailable" consistent card, L typing indicator on web, E first-run suggestions on web, C delete conversation (web) |
| Health | P per-type denied / limited, Er sync failed, S sync done toast, L skeleton on web cards |
| Timeline | L skeleton, Er retry, E filtered-empty, C delete (web has; iOS swipe has no confirmation) |
| Reports / Images | L upload progress with steps, Er upload failed / unsupported / too large (layout), "unreadable" result, C delete (iOS has), P camera denied (iOS), S analysis ready |
| Plan / Tasks / Meds | E per section, C delete item (web), S all-done celebration (iOS only), P notifications denied (reminders), Er save failed on web |
| Care | P location denied/limited (iOS partly), E no providers/appointments, L search |
| Profile / Settings | L skeleton, Er partial, S saved toast, C sign out (web), C disconnect Apple Health (web explainer) |
| Notifications | all states (feature missing) |

## 7. Components to extract into the design system

The same UI is built by hand in several places. These become shared components on **both**
platforms (same names, same props, tokens only):

| Component | Replaces / used by |
|---|---|
| `ListRow` / `NavigationRow` (icon badge, title, subtitle, trailing value/chevron) | Profile, Settings, Health timeline link, Care, Reports |
| `SectionCard` (title, action, content, empty slot) | Home sections, Profile sections |
| `StateView` (loading skeleton / empty / error / offline / permission, one API) | ad-hoc `EmptyStateView` + inline error labels |
| `SkeletonBlock` / skeleton variants per card | `.redacted` calls; web lacks skeletons |
| `Toast` / `Banner` (success, info, warning) | iOS ad-hoc labels; web inline messages |
| `ConfirmDialog` (destructive) | confirmation dialogs written per screen |
| `PermissionPrimer` (icon, why, what's shared, allow/not now, denied → Settings) | Health connect card, camera, notifications, location |
| `SourceBadge` (provenance: you / clinician / report / Apple Health / AI-inferred / sample) | ad-hoc source labels in Profile, Memory, Timeline |
| `AIGeneratedLabel` + `SampleContentLabel` | chat, reports, insights |
| `UrgentBanner` (escalation, visually distinct, always first) | chat escalation card, reports urgent banner, image result |
| `FilterChips` / `SegmentedTabs` (web has `Tabs`, iOS `SegmentedTabs`) | timeline, reports, appointments |
| `FormField` set (text, date, time, picker, textarea with counter) | profile forms, plan editor, timeline entry |
| `StepProgress` (upload/analysis steps, onboarding progress) | reports processing, onboarding |
| `EmptyIllustration` (mascot poses) | empty states |
| `AppointmentRow`, `ProviderCard`, `MedicationCard`, `NotificationRow` | new screens |

---

## UI completion plan

Every step ends with the checks listed. Web is verified in this environment (unit, typecheck,
lint, build, Playwright e2e on desktop/tablet/phone + axe). iOS is written here and **verified on
your Mac** (`⌘U` / `⌘R`), or by CI once GitHub Actions billing is restored. There's no Swift
toolchain in this environment.

| # | Step | Deliverables | Checks |
|---|---|---|---|
| 0 | **Preview mode foundation** | One sample dataset (`packages/sample-data`, JSON, every record `source: "sample"`) generated into Swift like the tokens. iOS service protocols for Chat, Documents, Profile/Memory, Timeline, Care, Notifications, Settings, with `Preview*` implementations. Web data provider interface with a `preview` implementation (`HEALTHMATE_DATA_SOURCE=preview`, no server needed). A global "Preview — sample data" banner. A debug **state switcher** to force loading/empty/error/offline/permission on any screen. | unit tests for the sample dataset + providers; web e2e runs in preview mode |
| 1 | **Design system extraction** | The §7 components on both platforms, gallery pages (iOS gallery, web `/design` in dev) | component tests, axe on gallery |
| 2 | **Auth & onboarding** | Intro → profile setup (name, goals, optional health info, skip) → consent → notification priming → Apple Health priming (iOS) / "connect on iPhone" (web) → done; auth success/"check your email"/offline states | e2e flow, iOS UI test |
| 3 | **Home + notifications** | Tappable everything (metric → detail, activity → item, appointment → detail); notification centre + bell; first-day and partial-failure states | e2e, UI tests |
| 4 | **AI Chat** | All states (suggestions, typing, sample responses clearly labelled, follow-ups, escalation first, AI unavailable, offline + retry, history with rename/delete, attach report/photo entry) | e2e incl. emergency → fixed escalation |
| 5 | **Health dashboard + HealthKit flows** | Web metric detail, skeletons, per-type permission states, denied → Settings, sync status, manual entry | e2e, UI tests |
| 6 | **Timeline** | Day grouping, filters, entry detail, add/edit, all states | e2e |
| 7 | **Medical reports** | Upload flow with steps, processing, result, unreadable/failed, original-file viewer, questions to share, all states (sample results marked sample) | e2e |
| 8 | **Image analysis** | Dedicated entry, purpose picker, capture guidance, quality retake, result layout with urgent banner, all states | e2e |
| 9 | **My Plan, Tasks, Medications** | Tasks overview, medication detail (verbatim instruction, schedule, adherence), unified medications (profile ↔ plan), reminders states | e2e, core unit tests |
| 10 | **Doctor / Care** | Care team, provider detail, appointments list/detail/add/edit, prepare-questions checklist, find care | e2e |
| 11 | **Profile, Settings, privacy & data** | iOS Settings screen, notifications settings, units, appearance, about, account (edit, change password UI), consents, export, delete, sign-out confirmations | e2e |
| 12 | **Polish pass** | Motion (with Reduce Motion), Dynamic Type XXL, dark mode, VoiceOver labels, iPad and tablet/desktop web layouts, parity review iOS ↔ web, refreshed screenshots | full e2e + axe, iOS UI tests, screenshot review |

Not in Phase 1: backend changes, real AI, real analysis, HealthKit upload, memory, and anything outside the PRD.
