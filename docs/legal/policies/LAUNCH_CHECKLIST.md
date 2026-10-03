# US launch checklist — adults and teens 13–17 (internal)

This lists what is still needed before launch. It isn't legal advice, and finishing it doesn't mean the
app complies with any law.

## Already in the app (keep it working)

- **Age gate on the server.** Production requires `AGE_ENFORCEMENT=enforce`. Health features stay locked
  until someone gives a date of birth.
- **Under-13s are excluded.** No account is created for them, and an existing under-13 account is locked
  and then deleted.
- **Permissions are checked whenever work runs.** Turning AI, report/photo analysis or Apple Health sync
  off stops queued work. Emergency guidance doesn't use the AI.
- **No date of birth goes to the AI**, and there is no parent access.
- **Delete and download.** People can delete their account and download their data from inside the app.
  Accounts without a password (Google or Apple only) confirm deletion by typing DELETE. The download includes
  emergency/urgent safety alerts (levels only, no message text).
- **Consent wording says where data goes.** The setup screens and Settings say what is sent to the AI
  provider and what is only stored. Apple Health readings reach the AI only when AI chat is also on.
- **Tests:** `test/age-eligibility.test.ts`, `test/age.test.ts`, `test/consent-enforcement.test.ts`,
  `test/dob-exposure.test.ts`, `test/isolation.test.ts`, `test/rls.test.ts`, `test/chat.test.ts`;
  web `e2e/app.spec.ts`; iOS `AgeRetryGuardTests`, `AccountDeletionTests`, `AccountSetupTests`.

## Remaining work, by who can do it (verified 2026-10-03)

"Verified" means a test in CI covers it. Nothing below says the app complies with any law.

### A. Code — done and verified in CI

| Item | Evidence |
|---|---|
| Date of birth asked in setup on web and iOS; the server decides; restricted accounts get only sign-out or delete; 7-day device guard (no date stored) | `test/age-eligibility.test.ts`, web E2E, iOS `AccountSetupTests`, `AgeRetryGuardTests` |
| An age refusal during a session sends the app back to setup (web and iOS) | web E2E, iOS `AgeRetryGuardTests` |
| Accounts without a password delete by typing DELETE (web Settings, iOS Settings, restricted screens) | `test/age-eligibility.test.ts`, `test/google-auth.test.ts`, `test/apple-auth.test.ts`, web E2E, iOS `AccountDeletionTests`, `AccountSetupTests` |
| Emergency guidance shows without AI permission and without a connection; nothing is sent to the AI | web E2E, iOS UI test `testSignUpRunsAccountSetupThenOpensHome` |
| Consent screens say what goes to the AI provider and what is only stored, and **name the AI company** the server is set up to use (`/v1/meta` `ai.recipients`) — checklist item 5 | `test/ai-gateway.test.ts`, web `ai-provider.test.ts`, `documents-consent.test.tsx`, iOS `AIProviderPhraseTests` |
| "Continue with Apple / Google" only shown where it works (Preview). On a real server neither app can get an ID token yet, so the buttons are hidden | web `social-sign-in.test.ts`, `sign-in-form.test.tsx`, iOS `SocialSignInTests` |
| Server verifies Google **and Apple** ID tokens (each turned on by its client IDs) | `test/google-auth.test.ts`, `test/apple-auth.test.ts` |
| Help page has a Contact section; it shows `HEALTHMATE_SUPPORT_EMAIL` when set | web `support.test.ts`, web E2E |
| Data download includes safety alerts (no message text) | `test/chat.test.ts` |

### B. Code — waiting on something in C or D before it can be built

| Item | Waiting on |
|---|---|
| Google sign-in in the iOS app (GoogleSignIn package, URL scheme) and on the web (Google Identity Services) | C1 |
| Sign in with Apple in the iOS app, and Apple token revocation when an account is deleted (App Store rule 5.1.1(v)) | C2 |
| A small server-only age-review action with an audit record (see "Age reviews" below) | C5 and the lawyer (D) |
| Apple's Declared Age Range / parental-consent flow for Texas, Utah, Louisiana | the lawyer (D3) |

### C. Needs your credentials or decisions

| # | Action | Exactly what's needed |
|---|---|---|
| C1 | **Google sign-in** (free) — or decide to launch with email only | Google Cloud project; OAuth consent screen (app name, support email, privacy policy URL, authorised domain; publish it); an **iOS OAuth client** for bundle ID `com.healthmate.app` (gives the client ID and its reversed "iOS URL scheme"); a **Web OAuth client** with your site as an authorised JavaScript origin. Then set `GOOGLE_CLIENT_IDS=<ios id>,<web id>` on the API and, with Supabase, enable the Google provider with the same IDs. Client IDs are public; the web client secret goes only into Supabase. |
| C2 | **Sign in with Apple** — decide whether to pay for the Apple Developer Program (USD 99/year; also needed for TestFlight, App Store, push) | An App ID with the *Sign in with Apple* capability; for the web, a **Services ID** with your domain and return URL; a **Sign in with Apple key** (.p8 file, Key ID, Team ID) for revoking tokens on deletion and for Supabase. Then set `APPLE_CLIENT_IDS=com.healthmate.app[,<services id>]`. Keep the .p8 key in the server's secret store, never in the repo or the apps. App Store rule 4.8: if the iOS app offers Google sign-in, it must also offer Sign in with Apple (or an equivalent option); email-only avoids this. |
| C3 | **Fill the policy placeholders** (22 `[[OWNER: …]]` marks in this folder) | Legal name; support, privacy and security addresses; postal address; hosting provider names and regions; backup retention; an appeal contact; incident contacts; dates. |
| C4 | **Check the AI provider's terms** (Anthropic, as configured) | Retention, no training on your data, processing location, whether teen data is allowed. **The chat consent screens already say messages "aren't used to train AI models"**: confirm that against the contract, or ask for the wording to change. Fill in "Copies held by the AI provider" in the Privacy Policy. |
| C5 | **Support and age reviews** | A support inbox; set `HEALTHMATE_SUPPORT_EMAIL` on the web app (restricted screens send people to Help). The age-review decisions in "Age reviews" below. |
| C6 | **Production settings** | `AGE_ENFORCEMENT=enforce` (production refuses anything else), `ANTHROPIC_API_KEY` (paid; your decision), Supabase project keys (or `JWT_SECRET` for local auth), and `PUSH_TOKEN_KEY` once push is on. APNs push needs the paid Apple program (C2). Secrets go in the hosting provider's secret store only. |

### D. Needs a lawyer or a clinician

| # | Action |
|---|---|
| D1 | Lawyer: review the five documents (with C3 filled in), then publish them at real URLs. Engineering then links them from sign-up, Help and Settings, replacing "will be published before launch". |
| D2 | Lawyer: the six questions below, including the 72-hour under-13 deletion period. |
| D3 | Lawyer: iOS app-store age laws (Texas, Utah, Louisiana) — whether Apple's age-range and parental-consent APIs must be supported, and from when. |
| D4 | Lawyer: approve the age-review workflow below (no ID from children). |
| D5 | Clinician: review the emergency and urgent rules (`packages/safety`), the escalation wording, and the teen guidance given to the AI, including crisis pathways for teens. |

### E. Needs a physical iPhone (can't run in CI)

1. Apple Health: permission prompts, first import, then turning a measurement off in the Health app.
2. Camera photo check and report upload from Files and Photos.
3. Voice input (on-device recognition and the fallback), with permission denied and allowed.
4. Account setup with an under-13 date, then sign out and try again (device guard); delete by typing DELETE.
5. Largest text size, VoiceOver and Reduce Motion on setup, chat with emergency guidance, and Settings.
6. Once C1/C2 exist: Google and Apple sign-in (URL scheme callback, first sign-in going through age setup), and deleting those accounts.
7. Once APNs exists: push notifications, including quiet hours and hidden details on the lock screen.

## Age reviews: how it works today, and a proposed minimal workflow

**Today** (tests: `test/age.test.ts`, `test/age-eligibility.test.ts`):

- **Under-13 answer:** restricted at once; deletion scheduled 72 hours later (`UNDER_13_DELETION_HOURS`).
  The person can only sign out or delete the account; no health feature or health data is reachable.
- **Under-13 answer, then an older date:** the account moves to "review", **stays restricted**, and the
  deletion deadline doesn't change. If no one acts, it is deleted when the deadline passes.
- **A teen who later enters an adult date:** keeps the teen setting and its protections until the
  turning-18 date on record. Not blocked, but an adult who mistyped a teen date stays on the teen setting.
- **The same device** can't answer again with another date for 7 days (no date of birth is stored).
- **No support tool exists.** Changing an age state today would mean editing the database by hand, with no
  audit record. Don't do that.

**Proposed minimal workflow** (needs D4 before use; changes no code, no deletion period and no access):

1. A person writes from Help to the support address (C5) **from the email address on the account**. Support
   asks for nothing else: no ID, no date of birth, no health details.
2. **Under 13, or a review after an under-13 answer:** support never unlocks it. Support explains that the
   account and anything in it will be deleted by the deadline shown on the screen (or now, if they delete it
   themselves), and that an adult who mistyped can create a new account afterwards.
3. **An adult on the teen setting by mistake:** nothing urgent (the account works, with teen protections).
   Same answer: delete and create a new account, or wait until the recorded turning-18 date.
4. Support keeps the email thread as the record and doesn't copy any date of birth into it.

**Later, only if the lawyer approves:** a server-only action (no app UI) that records who changed what and
why, can only delete early or move an account towards the stricter setting, and never lifts an under-13
restriction.

## Questions for the lawyer (short)

1. Is a teen's own consent enough for their health data in Washington, Nevada, Connecticut and New York, or
   does a parent need to be involved anywhere?
2. Must a parent agree to the Terms for under-18s? Can the Terms be enforced against a minor?
3. Can the consumer-health-data section stay inside the Privacy Policy, or must it be a separate page
   linked from the homepage?
4. How long should a suspected under-13 account be held before deletion? The app currently uses 72 hours.
5. Does the FTC Health Breach Notification Rule apply? (Confirm HIPAA doesn't before saying so.)
6. Does any AI-chatbot law, such as California SB 243, apply to the AI Health Assistant?

## Optional, later

- Include the list of recipients in the data download (already listed in the Privacy Policy).
- Include original uploaded files in the download.
- Hide photo analysis or long-term memory for teens if the lawyer recommends it.
- Treat a profile date-of-birth edit showing under 13 like the age question.
- Offer a review of data and fresh consent when a teen turns 18.
- **Under-13 support** (the long-term goal) needs verifiable parental consent and parent accounts. Don't
  build these until it's on the roadmap.
