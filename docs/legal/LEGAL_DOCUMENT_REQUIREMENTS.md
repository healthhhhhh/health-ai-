# HealthMate — Legal Document Requirements and Open Questions

> **2026-10-02:** unpublished drafts of the launch documents, written from the implementation for the US adult-and-teen scope, are in [`policies/`](policies/README.md). They need counsel review and owner facts before publication.

> **Status: requirements only. These are not drafts and must not be published.** A US privacy/healthcare lawyer must draft or approve every public document.
> Review date: **2026-10-01**. Cross-references: `HEALTHMATE_DATA_FLOW_AUDIT.md` (Audit) and `US_LAUNCH_COMPLIANCE_CHECKLIST.md` (Checklist).

**Values that do not exist yet and must not be invented:**
- the legal entity or operator name used publicly;
- a postal address;
- a support or privacy email;
- governing law and venue;
- retention periods;
- AI provider contract terms;
- security certifications;
- an effective date.

Each document below marks these as `‹TBD›`.

**Age scope (revised 2026-10-01):**
- **Long-term goal:** HealthMate for all ages.
- **Initial release:** which age groups are enabled is **undecided** (Checklist §6.7).
- **Code today:** no age screen, no parental consent and no child or teen safeguards (Audit §8).

Each document below must be written for the scope actually chosen and built. It must not describe child or teen protections that don't exist. Requirements that apply only if minors are enabled are marked **[if minors]**.

Every public document must match the code at the time it is published. Re-check against the Audit before publishing and after every change to data flows.

---

## 1. Terms of Service

**Purpose:** the contract governing use of the iOS app and the website.

**Must cover:**
1. **Parties:** the operator ‹TBD›: the individual developer, or a future entity (Checklist §10.1).
2. **Eligibility**:
   - Ages allowed at launch: ‹TBD per Checklist §6.7›. US residents.
   - State how age is checked; the description must match the age screen once it is built (Audit §8 — none exists today).
   - **[if minors]** Minors generally can't be bound by contract the way adults can **[COUNSEL]**. Terms for minors need a parent or guardian to agree. Utah's App Store Accountability Act bars enforcing terms against a minor unless parental consent was verified through the app store (Checklist §6.1.6).
   - **[if caregivers]** Terms for adults managing a child's or teen's information: authority, and what happens at 18.
3. **The nature of the service:** an AI health companion and information tool. Not medical care, not a doctor, not for emergencies. It incorporates the Medical Disclaimer (§3).
4. **Accounts:** credentials, security, a single user per account, sign-in methods (email/password; Google if enabled).
5. **User content:** reports, photos, notes and chat. The user's licence to the operator is limited to providing the service. The user is responsible for having the right to upload documents.
6. **AI output:** may be wrong; describes possibilities rather than diagnoses; never changes medications (enforced in code: `ai.tasks.ts`, `chat.prompts.ts`). Users must not rely on it for decisions without a clinician.
7. **Acceptable use** (§6), by reference.
8. **Termination and suspension**, including for under-18 users and misuse; what happens to data on termination (link to §5).
9. **Disclaimers and limitation of liability** appropriate to health information **[COUNSEL]**: which limits are enforceable for consumers, by state.
10. **Dispute resolution:** arbitration, class-action waiver, small-claims carve-out, opt-out window **[COUNSEL]**; governing law ‹TBD›.
11. **Changes to terms:** notice method and, for material privacy changes, consent (FTC position).
12. **Third-party services:** Apple (HealthKit, MapKit, speech) and Google Maps links. The App Store's required terms for apps distributed through Apple (minimum terms in Apple's standard EULA, if a custom EULA is used).
13. **Contact:** ‹TBD›.
14. **Paid features** (§7), if any.

**Implementation requirements (engineering; nothing changed in this audit):**
- Record acceptance: document version, timestamp, user id and platform. **Today nothing records it** (Audit §9).
- Replace the placeholder links: `AppLinks.terms` (`apps/ios/HealthMate/App/AppServices.swift`) and `/help#terms` (web).
- Re-prompt on material changes.

**Open questions:**
- Q1. Is arbitration appropriate for a health product used by consumers, and in which states is it enforceable?
- Q2. How should liability be limited for AI health information without being unconscionable?
- Q3. Do the Terms need state-specific addenda (e.g. California, Washington)?
- Q4. Should accounts be restricted to US residents, and how (App Store territory; web geolocation is not in code)?

---

## 2. Privacy Policy, plus the state Consumer Health Data Privacy Policy

**Purpose:** a complete, accurate description of data practices (FTC §5; Apple 5.1.1(i); state laws).

**Must cover, sourced from the Audit:**
1. **Categories collected** (Audit §2). Account; profile, including DOB and sex; conditions, allergies, medications; memories, including AI-derived ones with provenance; chats; uploaded documents and photos; HealthKit types (steps, heart rate, resting heart rate, active energy, weight, sleep); symptoms; mood; plans; care providers; appointments; notifications; consents; operational records (audit, safety events, AI usage); device push tokens.
2. **Sources:** the user; the user's iPhone HealthKit; documents the user uploads; AI-generated content.
3. **Purposes per category**, and an explicit statement of what is **not** done: no sale, no advertising, no tracking. These match the code today (Audit §3) and become binding promises.
4. **Recipients and processors** (Audit §3):
   - hosting ‹TBD›;
   - Supabase;
   - the AI provider (named; ‹TBD› whether Anthropic is used at launch);
   - the Redis host ‹TBD›;
   - Apple: APNs, MapKit search, and server-side speech recognition when on-device recognition is unavailable;
   - links out to Google Maps and findahelpline.com.
5. **What the AI provider receives, in plain words** (Audit §4.2):
   - for chat: profile details (age in whole years — not the date of birth — sex, conditions, allergies, medications), selected memories, relevant Apple Health summaries and recent messages;
   - for reports and photos: the whole file;
   - for emergencies: nothing — handled without AI.
6. **HealthKit-specific statements** (Apple 5.1.3; HealthKit terms):
   - the types read;
   - read-only;
   - not used for advertising;
   - shared with the AI provider only with permission (once implemented);
   - not stored in iCloud.
7. **Retention by category** (‹TBD› — Audit §5; there are no decided periods today), including backups and operational records.
8. **Deletion** (§5 of this document), **export**, **correction**, and **consent withdrawal**, with honest exceptions. Queued work is now stopped on withdrawal (Audit §4.2, fixed 2026-10-02); disclose that a request already sent to the AI provider can't be recalled.
9. **Security:** describe it in general terms. Do not claim certifications or guarantees.
10. **Children and age.** Describe the age groups actually enabled, how age is determined, and what happens to accounts outside that scope (COPPA actual knowledge — Checklist §6.1.3).
    - **[if under-13]** A COPPA-compliant children's privacy notice (§2A).
    - **[if 13–17]** Teen-specific sections:
      - state minors' rights (CT, CO, NY, MD, and others per counsel's map);
      - no targeted advertising, sale or profiling;
      - what parents can and cannot see;
      - plain language a teen can understand.
11. **State rights sections:** Washington, Nevada and Connecticut consumer-health-data rights; California (CMIA/CCPA if applicable); other states as counsel maps them. Include the request method, verification, timelines and appeals.
12. **Breach notification commitment** consistent with the FTC HBNR and state law — no promises beyond the plan.
13. **Location of processing and storage** (‹TBD› — region not chosen; Audit §3).
14. **Contact and effective date** (‹TBD›).

**Consumer Health Data Privacy Policy** (Washington MHMDA, and similar in Nevada): a **separate** policy linked from the website homepage, listing:
- categories of consumer health data and their sources;
- purposes;
- categories shared, and with whom;
- how to exercise rights.

**Implementation requirements:**
- A public URL ‹TBD›.
- Replace `AppLinks.privacy` and `/help#privacy`.
- A homepage link to the consumer health data policy.
- Matching App Privacy details in App Store Connect.
- A privacy manifest in the app (Checklist §5.8–5.9).

**Open questions:**
- Q5. Is HealthMate a "provider of health care" under California CMIA §56.06? If so, how does that change disclosures to the AI provider?
- Q6. Is "necessary to provide the requested service" enough for basic record keeping under MHMDA, or is separate collection consent needed for each category?
- Q7. Are `safety_events` rule ids and `ai_usage` task names consumer health data, and must they be deleted with the account?
- Q8. Must the Privacy Policy disclose Apple's possible server-side speech processing and MapKit queries?

---

## 2A. Children's and teen documents [if minors]

These are needed only if minors are enabled. **None of the underlying features exist** (Audit §8).

| Document | Required when | Must cover | Open points |
|---|---|---|---|
| **COPPA online notice** (children's privacy notice) | Under-13 users enabled, or the service is found to be directed to children | Operator contact ‹TBD›. Each type of personal information collected from children and how it is used. **Each disclosure, including the AI provider**, and whether parents can consent to collection without that disclosure. The written data-retention policy. Parent rights (review, delete, revoke, refuse further collection). | Q25, Q26 |
| **Direct notice to parents** (before collection) | Under-13 | Why the parent is contacted; what will be collected; that consent is required, with **separate consent for non-integral third-party disclosure** (2025 amendment); how to give consent; deletion of the parent's contact if consent isn't given within a reasonable time | Q26 |
| **Verifiable parental consent records and forms** | Under-13 | The FTC-recognised method used; **purposes listed one by one**: account, AI chat, reports, photos, Apple Health sync, Apple Health in AI, memory, voice. Each revocable. | Q27 |
| **Written data-retention policy** (COPPA; also CT/CO minors) | Under-13 (required); 13–17 (strongly indicated) | Purpose per data category, a retention period ‹TBD›, the deletion mechanism, **no indefinite retention** | Q28 |
| **Written information-security program** | Under-13 (COPPA §312.8); good practice for all | Designated owner, risk assessment, safeguards, testing, vendor oversight, annual review | — |
| **Teen privacy notice / in-product explanations** | 13–17 | Plain language; sensitive topics; confidentiality vs. parental access; crisis resources; what happens at 18 | Q29, Q30 |
| **Parent/guardian terms and authority attestation** | Caregiver or dependent profiles | Proof of authority; custody changes; handover at 18 | Q31 |

## 3. Medical Disclaimer and AI Safety Notice

**Purpose:** set expectations at the point of use. This supports FTC truthfulness, Apple 1.4.1 and FDA positioning.

**Must cover:**
1. HealthMate is an **AI Health Assistant**, not a doctor (CLAUDE.md naming). AI content is labelled "AI-generated" and shows what it was based on. This exists in code via the `context` payload and the "based on" label.
2. It does not diagnose, prescribe, or change medications or doses.
3. **Emergencies:** call emergency services. The app shows fixed emergency guidance without AI for detected emergencies (`chat.service.ts`). State the limits of detection: it is keyword- and rule-based and can miss things.
4. AI can be wrong or incomplete. Verify with a clinician before acting (Apple 1.4.1).
5. Report explanations copy values and flags **as printed on the document**. They are not clinical interpretation.
6. Photo checks are general observations, not diagnoses. The **feature may be disabled pending the FDA assessment** (Checklist §11).
7. Metrics are compared with the user's own usual range, never "normal" or "abnormal" (CLAUDE.md).
8. No clinician reviews AI answers.
9. Mental-health crisis resources (the code links findahelpline.com). Counsel to confirm whether a specific US resource, such as 988, must be named — product decision.

10. **[if minors]** Age-appropriate versions: a teen version in plain language, and a parent-facing version for children. Pediatric limits: no weight-based dosing (the AI never gives doses — `ai.tasks.ts`); infant and child red flags need pediatric clinical review first (triage rules are adult-oriented and pending clinical review — Audit §8).

**Placement requirements:** before first chat use, near every AI answer (it already exists as `Disclaimer`/`DisclaimerView` in the UI), and in the Terms. Urgent and warning content must stay visually distinct (CLAUDE.md).

**Open questions:**
- Q9. What wording keeps symptom Q&A, photo checks and report explanations outside FDA device regulation, or does the intended use itself need to change?
- Q10. Does any state law (Utah HB 452, NY GBL Art. 47, California SB 243) require periodic "you are talking to AI" disclosures for this product?

---

## 4. Health Data Consent and AI Processing Disclosure

**Purpose:** the in-product consents that state health-data laws and Apple require. Consent switches exist today: `ai_processing`, `document_processing`, `health_data_sync`, `voice` (`account.service.ts`). They need these changes:

| Requirement | Today (code) | Needed |
|---|---|---|
| Name the third-party AI provider and say what it receives | "our AI provider" (Settings); the iOS onboarding copy doesn't mention external sharing (Audit §4.2) | Named provider; data categories per feature; link to the provider's terms ‹TBD› |
| **Separate** consent to collect vs. consent to share (MHMDA, Nevada) | One switch per feature | Counsel to define the structure (Q6) |
| HealthKit data to the AI | Covered only implicitly by `ai_processing` | Explicit HealthKit-to-AI permission, or exclude HealthKit data from AI context until it exists |
| Record the exact text the user agreed to | Only `version="2026-09"` is stored (`CONSENT_VERSION`) | A version registry mapping each version to its copy; store platform and locale |
| Withdrawal takes effect | Checked when requested **and when work runs** (fixed 2026-10-02); queued analyses are stopped. An in-flight provider call can't be recalled (its result is discarded). | Disclose the in-flight limit |
| Voice | `voice` consent exists; Apple speech may run server-side when on-device recognition is unsupported | Accurate copy |
| Default state | Off until granted (`hasConsent` returns false when there's no record) | Keep this |
| **Who consented** | Not recorded; there is only one account holder | **[if minors]** Record whether the user or a parent/guardian consented, the age group, and the method (VPC method for under-13) |
| **Consent per purpose for minors** | One switch per feature; some flows (memory, Apple Health in AI) have no separate consent | **[if minors]** Granular, separately revocable consent for each purpose (Checklist §6.5) |
| **Minors' AI disclosure** | Age in whole years (not the DOB) goes to the AI provider, which still reveals a minor | **[if minors]** Age band only; disclose the AI provider by name to parents/teens; review the provider's terms on minors' data **[FACT?]** |

**Open questions:**
- Q11. Must consent be re-collected when the AI provider or model family changes?
- Q12. Is one combined "AI processing" consent enough for chat, reports and photos, or are separate consents needed for each?

---

## 5. Account deletion and data-retention disclosures

**Must state (true to the code — Audit §6):**
- **What deletion removes immediately:** all account records (cascade), uploaded files, and the Supabase Auth identity.
- **What can remain, and for how long:**
  - audit-log entries with the account identifier — default 400 days, a placeholder;
  - de-linked safety-event and AI-usage records — 730 and 400 days, placeholders;
  - backups — ‹TBD›;
  - AI-provider copies — ‹TBD›;
  - data on the user's device.
- **How to delete:** in-app on iOS and web. Without app access: ‹TBD channel›.
- Interrupted deletions are completed automatically. Confirmation method: ‹TBD› (none sent today).
- **Retention for active accounts:** ‹TBD› per category. Today health data is kept until the user deletes it.

**[if minors] Parent rights and minors' deletion:**
- For under-13 users, parents can review, delete and revoke (COPPA).
- For teens, whether parents may access or delete depends on state law and HealthMate's confidentiality decision **[COUNSEL]**.
- Retention periods must be set per the written retention policy, not "until deleted".
- At 18, offer the user review and deletion of data collected while a minor.

**Open questions:**
- Q13. Can de-linked operational records be kept after deletion under MHMDA/CTDPA, or must they be erased?
- Q14. What backup retention is acceptable, and how should "deleted from backups" be handled (restore-and-purge)?
- Q15. Should inactive accounts be deleted automatically, and after how long?

---

## 6. Acceptable Use Policy

**Must cover:**
- No use by anyone under 18.
- No accounts for or about another person without authority. **The code supports only self-use.** Caregiver use for a child or teen is part of the all-ages goal. It is not built, and the AUP must not permit it until parent/guardian accounts with proof of authority exist (Checklist §6.8 M17).
- **[if minors]** Rules on what minors may upload. Photos of the body are off for minors at first (Checklist §6.5); no intimate images.
- No uploading other people's health records without permission.
- No attempts to extract the system prompt, inject instructions through documents, or misuse the AI. The code detects document prompt injection (`containsInstructionsToAi`).
- No scraping, reverse engineering, abuse of rate limits, or security testing without permission. Point to the vulnerability-disclosure contact ‹TBD›.
- No illegal content; no images outside the supported scope (e.g. intimate images). The image prompt marks these unsupported. Counsel to define reporting duties for illegal content such as CSAM (federal reporting obligations for providers) **[COUNSEL]**.
- Enforcement: suspension and termination.

**Open questions:**
- Q16. What are the operator's obligations if illegal imagery is uploaded? How do retention and reporting interact with deletion rights?

---

## 7. Subscription, cancellation and refund terms (only if paid features are introduced)

**Must cover:**
- Price, billing period, renewal, and free-trial conversion.
- How to cancel: iOS through Apple subscriptions; web ‹processor TBD›.
- Refunds: Apple handles iOS; web policy ‹TBD›.
- What changes when a subscription ends, including data access. **Health data access must not be held hostage** — product principle; confirm with counsel.
- **Laws:**
  - ROSCA;
  - state automatic-renewal laws (e.g. California);
  - Apple 3.1.1/3.1.2.
  - The FTC's 2024 click-to-cancel rule was vacated on July 8, 2025. Re-check for any new rulemaking.
- AI usage limits: describe them truthfully. An internal monthly cost limit exists today and is never shown to users (`AI_MONTHLY_USER_BUDGET_USD`). Disclose how limits affect service. Urgent safety guidance still works when the limit is reached (deterministic escalation).

**Open questions:**
- Q17. If limits differ by tier, how should "AI unavailable this month" be disclosed so it isn't deceptive?

---

## 8. Internal procedures (not public, but required before launch)

### 8.1 Privacy-request procedure
- **Intake channels:** in-app (export/delete exist) plus a non-app channel ‹TBD›.
- **Identity verification:** signed-in session; for email requests, a verification method ‹TBD›. Never ask for more health data to verify identity.
- **Request types:** access/confirm, list of third parties, export, correct, delete, withdraw consent, appeal (state laws).
- **Clocks:** the strictest applicable deadline (counsel to set; MHMDA 45 days — confirm). Log each request without health content.
- **Processor flow-down:** delete or instruct deletion at Supabase backups (‹TBD›) and the AI provider (‹TBD›).
- **Records:** a request log kept for ‹TBD› period.

### 8.2 Security-incident and breach procedure
- **Roles:** for an individual operator, name a backup contact ‹TBD›, an outside counsel ‹TBD›, and possibly a forensics contact via an insurer.
- **Detect:** sources include provider alerts, error logs, user reports and the vulnerability-disclosure inbox ‹TBD›.
- **Contain:** rotate keys (Supabase secret key, `JWT_SECRET`, `PUSH_TOKEN_KEY`, `EMBED_FUNCTION_SECRET`, AI key), revoke sessions, disable features (AI routes can be set to `none`), and preserve evidence.
- **Assess:**
  - What data was involved, and whose?
  - Was it an unauthorized disclosure (HBNR)?
  - Which states are affected?
  - Was it encrypted?
- **Notify:** individuals within 60 days under the HBNR (sooner where state law requires); the FTC (500 or more: at the same time as individuals; otherwise the annual log); state attorneys general; the media where thresholds are met. Use templates pre-approved by counsel.
- **Post-incident:** root-cause review; update this audit.
- **Engineering prerequisites (Checklist §1.2):**
  - remove row values from error logs;
  - a query to list affected users;
  - a bulk notification email path;
  - production access logging.

### 8.2A Minors' procedures [if minors]
- **Verify a parent's identity** before giving them a child's data. Do not ask for more of the child's health data to verify.
- **Out-of-scope age discovered:** block or route the account, delete data collected without required consent, and log the decision without health content.
- **Revoked parental consent:** stop processing, including queued jobs (Audit G6), and delete as required.
- **Minors in incidents:** parent notification for under-13; state requirements.
- **Turning 18:** re-consent and the deletion offer.

### 8.3 Change control for data flows
Any new SDK, provider, data field, AI route (`AI_ROUTES`), log line or retention setting must:
- update the Audit (§2–4);
- re-check the Privacy Policy, the consents and the App Privacy details;
- add or adjust tests. CLAUDE.md requires automated tests for all safety behaviour.

---

## 9. Master list of open questions for counsel

| # | Question | Section |
|---|---|---|
| Q1–Q4 | Terms: arbitration, liability limits, state addenda, US-only restriction | §1 |
| Q5 | CMIA §56.06 deemed-provider status | §2 |
| Q6 | MHMDA "necessary" vs. separate collection consent | §2 |
| Q7 | Are safety events and AI-usage task names consumer health data? | §2 |
| Q8 | Disclosure of Apple speech and MapKit processing | §2 |
| Q9 | FDA intended-use wording, and whether features must change | §3 |
| Q10 | AI-disclosure laws (UT, NY, CA) | §3 |
| Q11–Q12 | Consent granularity, and re-consent on a provider change | §4 |
| Q13–Q15 | Post-deletion residue, backups, inactivity deletion | §5 |
| Q16 | Illegal-content obligations | §6 |
| Q17 | Disclosure of paid-tier limits | §7 |
| Q18 | HBNR status (vendor of PHR?) and breach-content requirements | Checklist §1.2 |
| Q19 | Confirm HIPAA non-applicability on current facts; triggers to watch | Checklist §2 |
| Q20 | App-store age-law obligations (Texas, Utah, Louisiana) for each launch option, including adults-only | Checklist §6.1.6 |
| Q21 | Is a neutral, self-declared age screen on the web enough for each option? How does California AB 1043 (2027) apply? | Checklist §6.1.7 |
| Q22 | Entity formation, insurance, and how the seller name appears on the App Store | Checklist §10.1–10.2 |
| Q23 | Which state comprehensive privacy laws apply at expected scale | Checklist §3.5 |
| Q24 | Whether SB 243, NY GBL Art. 47 or Utah HB 452 definitions cover HealthMate's persona and mood features | Checklist §3.6 |
| Q25 | Does all-ages positioning or the "Mate" mascot make HealthMate "directed to children" or mixed-audience under COPPA, even in an adults-only launch? | Checklist §6.1.5 |
| Q26 | Is the AI provider a COPPA "third party" needing **separate** parental consent, or is its processing integral to the service? | Checklist §6.2.4 |
| Q27 | Which verifiable parental consent methods fit an individual developer, and is a paid verification vendor needed? | Checklist §6.2.3 |
| Q28 | Retention periods for minors' data by category (COPPA written policy; CT/CO "no longer than necessary") | Checklist §6.2.7 |
| Q29 | For 13–17-year-olds, who consents under MHMDA, NV, CT, CO and NY — the teen or a parent? Per state. | Checklist §6.3 |
| Q30 | Teen confidentiality: what parents may see (state minor-consent laws for sexual/reproductive health, mental health, substance use); any reporting duty if abuse is disclosed | Checklist §6.3 |
| Q31 | Caregiver/dependent profiles: proof of authority, COPPA status of parent-entered data, handover at 18, custody disputes | Checklist §6.4.3 |
| Q32 | Can minors' medical reports, health images, symptom chats, Apple Health data and long-term memory be processed at all, and under which consents? | Checklist §6.5 |
| Q33 | Do the AI provider's terms or usage policy allow processing minors' data, and on what conditions? | Checklist §6.5 |
| Q34 | Which state minors' privacy and design-code laws apply at expected scale, given thresholds and litigation (CA AADC; MD Kids Code; TX SCOPE; VT and NE design codes) | Checklist §6.3 |
