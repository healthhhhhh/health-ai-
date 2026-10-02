# HealthMate — Launch Policy Drafts (US: adults and teens 13–17)

> **STATUS: UNPUBLISHED DRAFTS — NOT LEGAL ADVICE — NOT APPROVED.**
> Written by engineering from the implementation as of 2026-10-02 so counsel can review them against
> what the product really does. They must not be linked from the app, the website or a store
> listing until (1) counsel has reviewed and approved them, (2) every placeholder is filled, and
> (3) each is served from a real production URL that clients link to. None of them claims that
> HealthMate complies with any law, is cleared as a medical device, or removes liability.

## Documents

| # | Draft | File |
|---|---|---|
| 1 | Terms of Service | [`01_TERMS_OF_SERVICE.md`](01_TERMS_OF_SERVICE.md) |
| 2 | Privacy Policy | [`02_PRIVACY_POLICY.md`](02_PRIVACY_POLICY.md) |
| 3 | Consumer Health Data Privacy Policy (Washington, Nevada, Connecticut and similar laws) | [`03_CONSUMER_HEALTH_DATA_PRIVACY_POLICY.md`](03_CONSUMER_HEALTH_DATA_PRIVACY_POLICY.md) |
| 4 | AI and third-party data-sharing disclosure | [`04_AI_AND_THIRD_PARTY_DISCLOSURE.md`](04_AI_AND_THIRD_PARTY_DISCLOSURE.md) |
| 5 | Teen privacy and age eligibility notice | [`05_TEEN_PRIVACY_AND_AGE_ELIGIBILITY.md`](05_TEEN_PRIVACY_AND_AGE_ELIGIBILITY.md) |
| 6 | Medical disclaimer and emergency guidance notice | [`06_MEDICAL_DISCLAIMER_AND_EMERGENCY.md`](06_MEDICAL_DISCLAIMER_AND_EMERGENCY.md) |
| 7 | Data retention, deletion and privacy-request procedure | [`07_RETENTION_DELETION_AND_PRIVACY_REQUESTS.md`](07_RETENTION_DELETION_AND_PRIVACY_REQUESTS.md) |
| 8 | Security incident and breach-response procedure (internal) | [`08_SECURITY_INCIDENT_AND_BREACH_RESPONSE.md`](08_SECURITY_INCIDENT_AND_BREACH_RESPONSE.md) |

Documents 1–7 are public-facing drafts; document 7 also includes the internal procedure. Document 8
is internal only.

## Conventions

- `[[OWNER: …]]` — a fact only the owner can supply (legal name, address, contacts, dates, choices).
- `[[COUNSEL: …]]` — a legal judgement or wording counsel must decide. These drafts don't decide them.
- `[[DEPLOY: …]]` — depends on production configuration that doesn't exist yet (regions, providers, backups).
- Statements about behaviour describe the code as of the commit that added or last changed the draft.
  They are backed by `docs/legal/HEALTHMATE_DATA_FLOW_AUDIT.md` (the "Audit") and `docs/architecture.md`.
  If the code changes, the drafts must change with it.

## Facts the drafts depend on (from the code)

- **Who is served.** Ages 13–17 and adults, in the United States. Under-13s are excluded: an age under 13 at
  sign-up creates no account; an existing account found to be under 13 is restricted immediately and
  deleted after a short hold (`UNDER_13_DELETION_HOURS`, default 72 — a placeholder for counsel).
  Production refuses to start without age enforcement (`AGE_ENFORCEMENT=enforce`).
- **Age.** The server computes an age band from a date of birth the person gives. No ID document, selfie
  or biometric is collected. For 13–17-year-olds only, the date they turn 18 is kept so their band can
  follow their birthdays.
- **AI.** All AI calls go through the server. When an external AI provider is configured, it receives
  what is listed in document 4 (chat context with the age in whole years — never the date of birth;
  reports and photos for analysis). Processing needs the person's current consent, checked again when the
  work runs; withdrawing stops queued work. A request already sent to a provider can't be recalled.
- **Parents.** There is no parent or guardian access of any kind.
- **No sale, no ads, no analytics SDKs.** None exist in the code (Audit §3).

## Open items that block publication

See "Remaining legal questions" in `US_LAUNCH_COMPLIANCE_CHECKLIST.md` §6.9 and the owner placeholders in
each draft. In particular: the operator's legal identity and contacts; the AI provider's contract,
retention and training terms; hosting and database regions; backup retention; the support channel
that privacy requests and age reviews depend on; and the client screens (age question, consent and
these notices), which do not exist yet.
