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
- **Tests:** `test/age-eligibility.test.ts`, `test/age.test.ts`, `test/consent-enforcement.test.ts`,
  `test/dob-exposure.test.ts`, `test/isolation.test.ts`, `test/rls.test.ts`.

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
