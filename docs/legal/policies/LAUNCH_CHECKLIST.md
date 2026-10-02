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
  Accounts without a password (Google only) confirm deletion by typing DELETE. The download includes
  emergency/urgent safety alerts (levels only, no message text).
- **Consent wording says where data goes.** The setup screens and Settings say what is sent to the AI
  provider and what is only stored. Apple Health readings reach the AI only when AI chat is also on.
- **Tests:** `test/age-eligibility.test.ts`, `test/age.test.ts`, `test/consent-enforcement.test.ts`,
  `test/dob-exposure.test.ts`, `test/isolation.test.ts`, `test/rls.test.ts`, `test/chat.test.ts`;
  web `e2e/app.spec.ts`; iOS `AgeRetryGuardTests`, `AccountDeletionTests`, `AccountSetupTests`.

## Essential before launch

| # | Item | Who |
|---|---|---|
| 1 | ~~Ask for the date of birth in the apps~~ **Done (2026-10-02):** setup on web and iOS asks for the date of birth and has the server check it before saving anything; restricted accounts see a clear screen (sign out or delete — Google-only accounts confirm by typing DELETE), and a device guard (7 days, no date stored) stops retrying with another date after a restriction | Eng |
| 2 | **Fill the placeholders:** legal name, contact and privacy email, postal address, provider names and regions, backup retention. | Owner |
| 3 | **Check the AI provider's terms:** retention, no training on your data, where it processes data, and whether teen data is allowed. Then fill those details into the Privacy Policy and the Consent Notice. | Owner |
| 4 | **Have a lawyer review the five documents**, then publish them at real URLs and link them from sign-up and Settings (replacing today's placeholder links). | Owner + Lawyer |
| 5 | **Show the consent notice next to the permission switches**, naming the AI provider. Today the in-app text only says "our AI provider". | Eng (copy) |
| 6 | **iOS app-store age laws (Texas, Utah, Louisiana):** support Apple's age range and parental-consent flow, or confirm with a lawyer what applies to this app. | Eng + Lawyer |
| 7 | **Set up a support inbox and a way to resolve age reviews**, including a mistyped under-13 date, without asking for ID. | Owner |
| 8 | **Get a clinical review** of the emergency rules and the teen guidance given to the AI. | Clinician |
| 9 | **Fill in the incident-response contacts.** | Owner |

### Age reviews today (background for item 7)

How the app behaves now (tests: `test/age.test.ts`, `test/age-eligibility.test.ts`):

- **Under-13 answer:** the account is restricted at once and deletion is scheduled for 72 hours later
  (`UNDER_13_DELETION_HOURS`). The person can only sign out or delete the account.
- **Under-13 answer, then an older date:** the account moves to "review" but stays restricted, and the
  deletion deadline **doesn't change**. If no one acts, it is deleted when the deadline passes.
- **A teen who later enters an adult date:** they keep the teen setting (and its protections) until the
  turning-18 date already on record. The account isn't blocked, but an adult who mistyped a teen date
  stays on the teen setting.
- **The same device** can't simply try again with another date for 7 days (no date of birth is stored).

There is **no support tool**. Today, changing an account's age state means editing the database by hand,
which leaves no audit record. Before launch, the owner (with the lawyer) decides:

1. Who handles reviews, through which inbox, and how fast. Under-13 accounts are deleted after 72 hours.
2. What a person can show to resolve a review **without collecting ID from a child** (for example, a
   parent confirming by email).
3. Whether support may lift a block or only correct towards the stricter band.

Engineering then builds a small server-only action that records who changed what and why, with no
date of birth. Don't build it before these decisions are made.

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
