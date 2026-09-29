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
| 2 · Auth & onboarding | ✅ Done | See below |
| 3 · Home & notifications | ✅ Done | See below |
| 4 · AI Chat | ✅ Done | See below |
| 5 · Health & HealthKit | ✅ Done | See below |
| 6 · Timeline | ✅ Done | See below |
| 7 · Medical reports | ✅ Done | See below |
| 8 · Image analysis | ✅ Done | See below |
| 9 · Plan, tasks, medications | ✅ Done locally | See below. iOS CI blocked (GitHub Actions billing) |
| 10 · Care | ✅ Done locally | See below. iOS CI blocked (GitHub Actions billing) |
| 11 · Profile, settings, privacy | ⏳ Next | |
| 12 | ⬜ Not started | |

### Step 10: what was built

Everything here uses the existing care endpoints (providers and appointments), and nothing in the backend changed. HealthMate keeps the person's own record: it never books, changes or cancels anything with a clinic, and the screens say so.
- **Care hub** (web `/care`, now labelled "Care" in the nav; iOS `CareHubView` from Profile › "Care: appointments and care team", and from Home/notification links):
  - the emergency call banner always comes first, and stays visible even when care details fail to load (tested)
  - upcoming appointments and the care team, each with "See all" and Add
  - find care nearby (web map searches; iOS `CareFinderView`)
  - the crisis section
- **Appointments** (web `/care/appointments`, iOS `AppointmentsListView`):
  - Upcoming (soonest first) and Past (newest first, including cancelled)
  - empty states and an Add action
- **Add/edit appointment** (web `/care/appointments/new` and `/[id]/edit`, iOS `AppointmentEditorView`):
  - name, care team member, date and time (in the person's time zone), length, mode (in person / video / phone), place and notes
  - edits can clear fields (explicit nulls)
- **Appointment detail additions:**
  - Edit
  - **Questions to ask**, a checklist with suggested starters (add, tick off, remove). It's saved inside the appointment's notes as a "Questions to ask:" block (`- [ ]` / `- [x]`), in the same format on both platforms, so no storage changes were needed. It survives editing the notes.
  - "Mark as done" for a past appointment still marked scheduled
  - the provider links to their detail
  - "Prepare with the AI Health Assistant" goes to Chat
- **Care team** (web `/care/team`, `/new`, `/[id]`, `/[id]/edit`; iOS `CareTeamView`, `ProviderDetailView`, `ProviderEditorView`):
  - contact actions: call, directions, website
  - notes, and the appointments with them, with "Add appointment" preselecting them
  - edit, and remove with a confirmation that appointments stay
  - the website must be a full https:// address (same check on both platforms)
- **Shared logic:** `lib/care.ts` (`splitAppointments`, `parsePrep`/`serializePrep`, `zonedIso`/`zonedParts`) and Core `CarePresentation.swift` (`AppointmentList`, `AppointmentPrep`, `AppointmentDraft`, `CareProviderDraft`), plus new Core endpoints (`careProviders`, `saveCareProvider`, `deleteCareProvider`, `saveAppointment`, `setAppointmentNotes`). Tested on both platforms, including a round trip through the iOS Preview client.
- **Verification:**
  - web unit 97/97 and e2e 170/170 (new: hub order + axe, past/upcoming, add → questions → reload → edit → cancel, care team add/validate/link/edit/remove, the error state keeps emergency help)
  - API 89/89, unchanged
  - iOS core 117/117
  - new iOS UI test: Profile › Care → emergency first → appointment questions saved
  - **iOS app build/UI tests are still blocked by GitHub Actions billing**

### Step 9: what was built

- **Plan views** on web (`/plans`, `/plans/tasks`, `/plans/medications`, with tabs) and iOS ("All tasks" and "Medications" cards at the top of My Plan).
- **All tasks:**
  - Today, split into "Time has passed", "Later today" and "Done", with an "Everything for today is done" state.
  - "Not done this week", with a reminder that items can still be ticked off on their day.
  - "Coming up", by day for the next 6 days.
  - An empty-plan state.
- **Medications, unified:** plan medications (with reminders) and profile medications, matched by name.
  - Each shows its source, its instructions exactly as entered, time and repeat, reminder on/off, and "Taken on X of Y scheduled days this week".
  - Instructions are never merged or rewritten: the plan's wording is shown, or the profile's when there's no plan item.
  - A profile medication with no plan item offers "Add a reminder". This opens the add form with its name and instructions copied exactly (web `?add=profile-<id>`; iOS prefilled editor).
  - The never-change-a-dose disclaimer is on every medication screen.
- **Item detail:** iOS gains `PlanItemDetailView`, reached with the chevron on each row, matching the web detail:
  - kind, source, the verbatim instruction card, time, repeat, reminder and notes
  - a 7-day history with "x of y done"
  - Mark as taken/done today (or Undo), Edit, and Remove with a confirmation that it doesn't change a prescription
- **Reminder states:** when notifications are off, iOS shows a warning with Open Settings, on My Plan and on the item. The web says reminders are sent by the iPhone app.
- **States:** plan pages show error/offline states with Try again (web). iOS Medications says when profile medications couldn't load and still shows the plan.
- **Shared logic:** `lib/plan.ts` (`taskOverview`, `adherence`, `unifiedMedications`, `timeIn`) and Core `PlanOverview.swift` (`PlanSchedule.overview/history/adherence`, `PlanPresenter.describeRepeat`, `MedicationList.unify`), tested on both platforms.
- **Sample data:** unchanged. The sample-data safety test only allows the generic sample medications, so the e2e adds a medication through the profile to exercise "Add a reminder".
- **Verification:**
  - web unit 94/94 and e2e 158/158 (new: all tasks + axe, profile → medications → Add a reminder with the verbatim prefill, error states)
  - API 89/89, unchanged
  - iOS core 113/113
  - new iOS UI test: Medications verbatim instruction → item detail
  - **iOS app build and UI tests could not run:** GitHub Actions stopped starting jobs ("recent account payments have failed or your spending limit needs to be increased"). They need a CI run once billing is fixed.

### Step 8: what was built

Photo check now has its own guided flow. Photos are never analysed in Preview, and the real image-analysis backend was not changed.
- **Entry points:**
  - web `/reports/photo-check`, from the Reports page ("Check a photo instead"), chat's paperclip, and "Check another photo" on a result
  - iOS: a sheet from Reports & photos, chat's paperclip (it opens straight into the flow), and result screens
  - old `/reports?upload=photo` links redirect to the new page
- **Flow:**
  1. What it shows: skin or rash, cut or wound, swelling or bruise, something else.
  2. Take the photo, with guidance for that kind of photo plus general capture tips. iOS offers "Take a photo" or "Choose a photo"; web does the same with `capture="environment"`.
  3. Check and send: the photo, an optional note with a counter, and upload steps.
- **Safety first:**
  - "When not to wait" (call emergency services, don't wait for a photo check) is the first thing on every step.
  - A note describing an emergency or urgent problem shows the escalation card immediately, before anything is sent. It's the same on-device triage as chat.
  - After upload, Preview applies the real API's deterministic floor: an emergency note always produces emergency guidance. That guidance is always the first thing on the result, above the Sample label. There are tests on web, iOS and in the router.
- **States:**
  - camera permission denied, with Open Settings; no camera on the device
  - unsupported file, too large, offline (the photo is kept), upload error with Try again
  - processing steps
  - a poor-quality photo offers "Retake photo", which reopens the flow for the same purpose with a retake note and the tips
  - "We can't assess this kind of photo" offers Find care
- **Result:** your photo (labelled as an example image in Preview), what we can see, possible explanations ("not a diagnosis"), what you can do, warning signs, then next steps (Check another photo, Ask the AI Health Assistant, Find care).
- **Shared content:** in `lib/photo-check.ts` and Core `PhotoCheck` / `ImagePurpose.detail/tip`.
- **Verification:**
  - web unit 91/91 and e2e 149/149 (new: the full flow with axe, emergency note → guidance before sending and first on the result, blurry → retake, the old link redirect)
  - API 89/89, unchanged
  - iOS core 109/109
  - iOS UI test: chat → Check a photo → purpose → guidance

### Step 7: what was built

Reports are a complete UI in Preview mode. Files are never analysed: every result is the labelled sample, and the real document/analysis backend was not changed.
- **List:** filters (All / Reports / Photos, shared with iOS as `DocumentFilter`), search by name, file name · size · date on each row, per-filter empty states, "Nothing matches" with Clear search, and error/offline states with Try again (web and iOS).
- **Upload:** choosing a file no longer uploads it straight away. A confirmation shows the file (a thumbnail for photos, name, size), with "Upload and summarise" and "Choose another file"/Cancel. While uploading, step progress shows "Uploading securely → Reading the file → Writing a plain-language summary". Offline and server errors keep the file selected and offer Try again.
- **Processing:** the detail page shows the same steps, moving on as time passes, and says a notification will arrive.
- **Couldn't read:** failed uploads and unreadable reports share one layout with "Upload again", "Check the original" and three practical tips. In Preview, a file name containing "damaged" fails and "blurry" is unreadable, so both states can be demonstrated (a Preview tip says so).
- **Result:**
  - a count line ("4 within the report's range · 1 outside it"), with results outside the printed range first
  - "AI-generated · based on <file>, read <date> · not a diagnosis" for real results, or the Sample label in Preview (iOS now shows it too)
- **Questions for your doctor:** numbered, with Copy, Save as text (web) or Share (iOS), and "Ask the AI Health Assistant", which opens Chat with a question about the report. iOS uses a new `askAssistant` environment action for this.
- **Original file:** an in-app viewer. Web: `/reports/[id]/original`, an embedded PDF or image. iOS: PDFKit or an image, fetched through the signed link with a new `APIClient.download`. It has loading, error and offline states. In Preview it's labelled as an example file, because uploads aren't kept.
- **Shared logic** in `lib/reports.ts` and Core `DocumentPresentation`: steps, counts, ordering, questions text and sizes. It's tested on both platforms, including that no label says "normal" or "healthy".
- **Verification:**
  - web unit 90/90 and e2e 143/143 (new: confirm → steps → sample summary → questions → original file, damaged and unreadable, filters/search/no-match, error and offline, axe)
  - API 89/89, unchanged
  - iOS core 106/106
  - iOS app tests: `DocumentsViewModelTests`
  - iOS UI test: filters → report → labelled sample result and questions
  - CI note: web e2e first failed on a test race (search submitted before the filter navigation finished), fixed in Step 8. One iOS UI test (`testAddATaskToThePlan`) failed because the simulator couldn't launch the app ("Failed to get background assertion… pid 0"), before any test code ran. It re-ran with Step 8.

### Step 6: what was built

- **Filters** on both platforms: All, Reports & photos, Conversations, Symptoms, Medications, Readings, Appointments and Notes. They're the same set everywhere (`lib/timeline.ts` / Core `TimelineFilter`), each with its own empty state and "Show everything".
- **Grouping:** entries are grouped by day with Today/Yesterday. Each row shows its source and details.
- **Entry detail** (`/timeline/[id]`, iOS `TimelineEntryView`) shows:
  - the source ("You added this", "From a report"…)
  - details such as your severity rating
  - a link to what it's about (report, metric, appointment)
- **Edit and delete:** entries you added can be edited, and deleted after a confirmation. Entries from reports, Apple Health or chats can't be edited, and the detail says so.
  - Editing is Preview-only, because the real API has no PATCH yet. On a real server it says "not available on this server yet" instead of failing.
- **States:** loading, error/offline with retry, and load more.
- **Verification:**
  - web e2e 128/128 at the time (filters, detail, edit, delete)
  - iOS core 99/99
  - iOS UI test: filter → entry detail
  - CI green on `ea007ab`

### Step 5: what was built

- **Sample data:** the sample person now has 180 days of interconnected history:
  - sleep affects the next day's steps
  - a walking habit raises fitness, and resting heart rate drifts down with it
  - active energy follows steps
  - weight trends from 73.6 to 72.4 kg
  - it's generated in `packages/sample-data` and exported for iOS
- **Health dashboard (web and iOS):**
  - Today snapshot
  - Apple Health status card
  - 7/30/90-day ranges, with charts scaled to the data
  - metric details with a day-by-day list
- **Daily health history:** `/health/history` and iOS `HealthHistoryView`. Each stored day is compared with the person's own usual ("Your usual …"), with previous/next day. In Phase 2 this is fed by the real pipeline.
- **Apple Health states:** loading, empty/no-data, error, offline, permission request, denied (with Settings), disconnected, connected, syncing, sync failed and stale sync.
- **Adding a reading:** the web has a manual reading form, which saves to that day's history. iOS opens the Health app, because HealthMate never writes to HealthKit.
- **Not built:** exercise minutes aren't a separate metric, because that would need a HealthKit and API change. Activity is shown as active energy.
- **Verification:** CI green on `05d1f19` (web, API/Supabase, iOS build + unit + UI tests).

### Step 4: what was built

The chat is a complete UI in Preview mode. All replies are deterministic samples (keyword-matched sample conversations), and the real AI gateway was not changed.
- **Clearly sample:**
  - In Preview, every answer carries "Sample response in Preview mode · not a real AI, not medical advice", on both platforms.
  - The chat footer says the same.
  - Outside Preview, answers keep "AI-generated · not a diagnosis".
- **Safety first:** the on-device triage still runs before anything else. Emergency guidance appears instantly even when signed out, offline, without consent, or when AI is unavailable.
- **States:**
  - Welcome with suggested questions, and typing (dots that stay still with Reduce Motion).
  - Follow-up options, and the consent gate.
  - **AI unavailable:** a banner; messages aren't sent; Try again.
  - **Offline:** its own message and Retry.
  - A server error with Retry.
  - A deleted conversation's link explains itself instead of opening a blank chat.
  - Web: if the list can't load, the chat still works and the list offers a retry. If consent can't be checked, the page shows the offline/error state rather than breaking.
- **History:** open, rename (web inline; iOS swipe or long-press), and delete with confirmation, with relative dates. iOS shows a load-error state.
- **Attach:** the paperclip offers "Upload a report" or "Check a photo".
  - Web opens the Reports upload with that option chosen.
  - iOS opens Reports & photos.
  - The upload flows themselves are Steps 7–8.
- **Preview controls:** a new state, "AI unavailable", on web and iOS. Preview chat timeline entries are now titled after the conversation.
- **Not changed:** services/api, the AI gateway, report and image analysis, and health-data processing.
- **Verification:**
  - web unit 74/74 and e2e 107/107 (new: rename/delete, AI unavailable + emergency, offline, deleted-conversation link, attach, axe)
  - API 89/89, unchanged
  - iOS core 95/95
  - iOS app unit tests: offline and AI-unavailable chat
  - iOS UI tests: AI unavailable with emergency guidance, and attach → Reports & photos

### Step 3: what was built

Every item on Home now opens something; the bell opens a notification centre.
- **Notification centre** (web `/notifications`, iOS from the Home bell):
  - Today and Earlier groups.
  - Filters for unread and for each category.
  - Opening a notification marks it read and goes to what it's about.
  - Mark all as read, mark read/unread per item, and delete (web: options menu; iOS: swipe or long-press).
  - The unread count is shown on the bell.
  - Links are limited to screens the app has (`lib/links.ts` on web, `AppRoute` on iOS; the rules match and are tested on both).
- **Home:**
  - Metrics open their detail.
  - Activity opens its report, conversation, appointment, metric or the timeline.
  - Today's tasks open their detail (web).
  - Appointments come from Care and open their detail.
  - A section that fails to load shows its own retry, not an empty state (web).
  - A welcome note appears after onboarding.
- **New detail screens:**
  - Metric detail (web `/health/[kind]`, 7/30/60 days; iOS reuses the Health metric detail).
  - Appointment detail, both platforms: add to calendar (web), directions, call, prepare with the assistant, and mark as cancelled with a confirmation that it doesn't contact the clinic.
  - Plan item detail (web `/plans/[id]`): instructions exactly as entered, schedule, last 7 days, mark done, and remove with confirmation. Removing a medication says it doesn't change the prescription.
  - Account (web `/settings/account`): sign-in details and change password.
- **Found and fixed:**
  - The web plan list removed items with one tap and no confirmation; removing now happens on the detail page and asks first.
  - Unsigned simulator builds lost new sign-ins, because the Keychain refused the write. The session is now kept in memory for that launch.
  - The welcome sign-in sheet could open in the previous mode; it now uses `sheet(item:)`.
- **Verification:**
  - web unit 72/72
  - web e2e 92/92, including Home destinations, the notification centre, the account page, and axe on the new pages
  - iOS core 93/93
  - new iOS UI tests: bell → notification → appointment, and sign-up → setup → Home

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
