# HealthMate — US Launch Compliance Checklist

> **Status: working checklist for counsel review. Not legal advice and not a statement of compliance.** Nothing here has been confirmed by a lawyer.
> Review date: **2026-10-01**. Code facts come from `docs/legal/HEALTHMATE_DATA_FLOW_AUDIT.md` (cited as "Audit §n").
> Operator facts used: individual developer, no registered company, US-first, iOS + web, consumer-facing AI health companion. No partnerships with clinics, insurers or employers are known. If that changes, re-run §2.
> **Age policy (revised 2026-10-01):** the **long-term product goal is all ages** (children, teenagers and adults). **Which age groups the initial public release enables is not yet decided** (§6.7). The earlier assumption of a permanent 18+ policy is withdrawn. Today's code has **no age determination and no age-based controls of any kind** (Audit §8). Every launch option therefore needs new work before release.

**Three layers — always keep them apart:**

| Layer | What it is | Where |
|---|---|---|
| **Desired long-term product** | All-ages health companion | Operator decision, 2026-10-01 |
| **Proposed initial launch scope** | Not decided. Options compared in §6.7; recommendation in §6.7.4. | Decision pending (operator + lawyer) |
| **Implemented in code** | Backend *recording* of a self-declared age band only (2026-10-02: `POST /v1/me/age`, optional sign-up `ageScreen`, history table; never enforced). No age gate in any client, no app-store age signal, no parental consent, no parent or guardian accounts, no child- or teen-specific controls. Single-user accounts only. | Audit §8 (verified from source) |

**Legend**

| Column | Meaning |
|---|---|
| **Applies?** | **Likely** = appears applicable on known facts; **Depends** = turns on facts not yet established; **Unlikely** = appears inapplicable on known facts (still confirm with counsel) |
| **Status** | ❌ not started / not met in code · ⚠️ partial · ✅ met in code (not a legal sign-off) |
| **Owner** | Op = operator; Eng = engineering; Lawyer = US privacy/healthcare counsel |

Sources and review dates are listed in §12. Where a law's applicability depends on unestablished facts, the row says so.

---

## 1. FTC Act §5 and the FTC Health Breach Notification Rule

### 1.1 FTC Act §5 — unfair or deceptive practices
**Applies?** Likely. Section 5 covers any person or business in commerce, including individuals.

| # | Requirement / risk | Code status | Status | Owner |
|---|---|---|---|---|
| 1.1.1 | Every privacy and security statement must be true. Existing statements: "We never sell health data" (web `/help`), "never sold or used for advertising" (iOS Settings), "stops new processing right away" (iOS Settings), "Audio isn't stored" | The first two match the code. Queued work is now stopped when consent is withdrawn (Audit §4.2, fixed 2026-10-02); a call already in flight can't be recalled, only its result discarded — confirm the wording (Audit §9). | ⚠️ | Eng + Lawyer |
| 1.1.2 | No sharing of health data for advertising without affirmative express consent (FTC GoodRx, BetterHelp and similar orders) | No ad or analytics SDKs (Audit §3) | ✅ code | Op (keep it that way) |
| 1.1.3 | Substantiate health and AI capability claims (FTC Health Products Compliance Guidance; AI claims enforcement). Marketing must not imply diagnosis or clinical accuracy. | No marketing site copy reviewed. In-app copy says "not a doctor". | ⚠️ | Lawyer |
| 1.1.4 | Reasonable data security proportionate to the sensitivity of the data (FTC unfairness theory) | Code controls in Audit §7. No written security program; logs can contain row values (Audit §7 G7). | ⚠️ | Eng |
| 1.1.5 | Don't change privacy practices retroactively without affirmative consent (FTC position on material retroactive changes) | No policy exists yet to change | ❌ | Lawyer |

### 1.2 FTC Health Breach Notification Rule (16 CFR Part 318, amended effective July 29, 2024)
**Applies?** Likely, subject to counsel's confirmation. HealthMate appears to be a *vendor of personal health records*: its electronic record of identifiable health information draws from multiple sources (user entry, HealthKit, uploaded documents, AI-derived summaries) and is managed primarily for the individual. Since 2024, a "breach of security" includes an **unauthorized disclosure**, not only a hack. Sharing data with a third party in ways the user did not authorise can trigger notification.

| # | Requirement | Status | Owner |
|---|---|---|---|
| 1.2.1 | Confirm HBNR status (vendor of PHR vs. PHR-related entity vs. not covered) | ❌ | Lawyer |
| 1.2.2 | Written breach-response plan: detection, triage, decision log, who notifies and how | ❌ (nothing in repo — Audit §7) | Op + Lawyer |
| 1.2.3 | Notify affected individuals without unreasonable delay and **no later than 60 calendar days** after discovery, by email or in-app as the rule allows | ❌ no mechanism. Account email exists; no notification tooling. | Eng |
| 1.2.4 | Notify the FTC: at the same time as individuals if **500 or more** people are affected; otherwise in an annual log submitted within 60 days after the calendar year ends | ❌ | Op |
| 1.2.5 | Media notice where 500 or more residents of a state or jurisdiction are affected | ❌ | Op |
| 1.2.6 | Include the content the amended rule requires (what happened, data involved, **identity of third parties that acquired the data**, steps taken, protective steps, contact procedures) | ❌ | Lawyer |
| 1.2.7 | Contracts making service providers (hosting, Supabase, AI provider) notify HealthMate of breaches | ❌ not reviewed | Lawyer |
| 1.2.8 | Keep an inventory of *authorized* disclosures, so unauthorized ones can be recognised. Audit §3–4 is a starting point. | ⚠️ | Eng |

**Engineering prerequisites for breach response** (no code changed in this audit):
- an access audit trail for production data;
- a way to enumerate affected users for a given incident window;
- a way to email all affected users;
- removal of health data from error logs (Audit G7).

---

## 2. HIPAA applicability assessment

**Do not assume HealthMate is covered or exempt.** HIPAA applies to *covered entities* (health plans, clearinghouses, and health care providers that conduct standard electronic transactions such as billing) and their *business associates*.

| Question | Known facts (2026-10-01) | Provisional view | Needs |
|---|---|---|---|
| Is the operator a covered entity? | Individual developer; no clinical services; no insurance billing; no health plan | Appears **not** a covered entity | Lawyer to confirm |
| Is HealthMate a business associate? | Consumers download the app and use it for themselves. No contract with any provider, plan, employer or clinic is known. Users upload their *own* records at their own direction. | HHS guidance on health apps: an app chosen by the consumer that isn't engaged by a covered entity is generally **not** a business associate. Data the individual moves from a covered entity into such an app is no longer HIPAA-protected. | **Facts:** confirm no B2B deals, referrals, white-labelling, clinic portals or EHR integrations on behalf of providers |
| What would change this? | Any of these: a clinic, hospital, insurer or employer offering HealthMate to its patients or members under contract; HealthMate performing functions *for* a covered entity (remote monitoring, patient messaging); billing insurance; employing clinicians who bill electronically; receiving data from EHRs under a provider agreement | Any of these could create BA or covered-entity status, which brings the Privacy, Security and Breach Notification Rules plus BAAs with Supabase, the AI provider and hosting | Re-run this assessment before signing any partnership |
| Does the "clinician_provided" source label imply a provider relationship? | It is a user-entered provenance label (`profile.controller.ts` `source`). No clinician accounts exist. | No, on current code | — |
| Consequence if not HIPAA | FTC Act, the FTC HBNR and state consumer-health-data laws (§3) become the main regimes | — | — |

---

## 3. State privacy and consumer-health-data laws

Which of these apply depends on where users are located and on thresholds. A US-wide launch should be assumed to reach residents of every state unless access is limited **[COUNSEL]**.

### 3.1 Washington — My Health My Data Act (RCW 19.373)
**Applies?** Likely, if any Washington consumer uses the app or data is collected in Washington. There is **no revenue or volume threshold** for regulated entities; "small business" status only changed the 2024 compliance dates.

| # | Requirement (summary — confirm text with counsel) | Code status | Status |
|---|---|---|---|
| 3.1.1 | **Consumer Health Data Privacy Policy**, separate from and linked on the homepage | None (Audit G2) | ❌ |
| 3.1.2 | **Consent to collect** consumer health data for a specified purpose, unless collection is necessary to provide the requested service | `consents` exist for AI, documents and sync, but not for basic record keeping (symptoms, mood, conditions). Counsel must decide whether "necessary to provide the service" covers them. | ⚠️ |
| 3.1.3 | **Separate and distinct consent to share**, e.g. with an AI provider, unless necessary for the requested service | There is one switch per feature. It doesn't separate collection from sharing and doesn't name the recipient (Audit §4.2 G3). | ❌ |
| 3.1.4 | **Valid authorization** (signed, specific, expiring) before any *sale* | No sale path | ✅ code |
| 3.1.5 | Right to confirm and access, **including a list of all third parties and affiliates** the data was shared with | Export exists but has no third-party list (Audit §6) | ⚠️ |
| 3.1.6 | Right to delete, extending to processors and archived or backup systems | API deletion cascades. Backups, AI-provider copies and operational residue are undefined (Audit §6). | ⚠️ |
| 3.1.7 | Right to withdraw consent | Consent switches exist; withdrawal stops queued work (fixed 2026-10-02); in-flight provider calls can't be recalled | ⚠️ |
| 3.1.8 | Respond to requests within the statutory period (45 days, extendable — confirm); provide an appeal process | No request intake or contact channel | ❌ |
| 3.1.9 | Processor contracts binding processors to the regulated entity's instructions | Not reviewed | ❌ |
| 3.1.10 | Access restricted to those who need it; reasonable data security | Code controls exist; no written policy | ⚠️ |
| 3.1.11 | No geofencing around health care facilities | None in code; MapKit search is user-initiated and nothing is stored | ✅ code |
| 3.1.12 | Enforcement: violations are treated under Washington's Consumer Protection Act (RCW 19.86), which allows private suits — **confirm exposure with counsel** | — | — |

**Note:** MHMDA's definition of consumer health data includes **inferences** and data that identifies seeking health services. That covers AI summaries, triage levels and, arguably, `safety_events` rule ids and `ai_usage` task names (Audit §2.3).

### 3.2 Nevada — consumer health data law (SB 370, 2023; NRS Chapter 603A)
**Applies?** Likely, if Nevada consumers use the app. The obligations are similar: a consumer health data privacy policy; affirmative consent to collect and share; access and deletion rights with a list of third parties; security; a geofencing ban. Status: ❌ (same gaps as 3.1). **[COUNSEL]**: confirm definitions, exemptions and enforcement.

### 3.3 Connecticut — CTDPA consumer health data provisions (Conn. Gen. Stat. ch. 743jj)
**Applies?** Likely for Connecticut residents. The consumer-health-data controller provisions have **no volume threshold**. They require consent to *sell* consumer health data and restrict access to consumer health data. The general CTDPA obligations (privacy notice, rights, opt-in consent for sensitive data) apply when thresholds are met, and Connecticut's thresholds include processing *sensitive data* at all — **verify the current text, which was amended in 2025–2026 (e.g. Public Act 26-64)**. Status: ❌.

### 3.4 California
| Law | Applies? | Notes | Status |
|---|---|---|---|
| CCPA/CPRA (Civ. Code §1798.100 et seq.) | **Depends** on thresholds (annual revenue above the adjusted threshold, 100,000 or more consumers/households, or 50% or more of revenue from selling or sharing). An individual developer at launch probably falls below them. | Confirm revenue and volume. "Sensitive personal information" (health) rules apply once covered. | ❌ assess |
| **CMIA §56.06** — businesses offering software or apps designed to maintain medical information for the user's own management, or for diagnosis, treatment or management of a condition, are **deemed providers of health care** under the CMIA | **Depends — significant.** HealthMate stores medical information for self-management and offers report and photo explanations. | If deemed a provider: CMIA confidentiality, authorization rules for disclosures (including to the AI provider), and penalties/private remedies. **[COUNSEL] priority question.** | ❌ |
| **AB 489 (2025, operative Jan 1, 2026)** — AI must not use terms implying the advice comes from a licensed health professional | Likely relevant | "AI Health Assistant" (not "AI Doctor") is consistent with CLAUDE.md. Review the mascot "Mate" persona, marketing and all copy. | ⚠️ |
| **SB 243 (2025, effective Jan 1, 2026)** — companion chatbots | **Depends** on whether HealthMate is a "companion chatbot" (the definition centres on sustained social or relationship interaction) | HealthMate has a named persona and a mood check-in. Crisis referral exists: emergency triage plus findahelpline links. **[COUNSEL]** | ❌ assess |
| Automatic Renewal Law (Bus. & Prof. Code §17600 et seq.) | Only if paid subscriptions are offered | See §9 | n/a now |

### 3.5 Other comprehensive state privacy laws
Virginia, Colorado, Utah, Texas, Oregon, Montana, Iowa, Delaware, New Hampshire, New Jersey, Tennessee, Minnesota, Maryland, Indiana, Kentucky, Rhode Island, Nebraska and others.
**Applies?** Depends, mostly on volume/revenue thresholds. **Watch:**
- Texas TDPSA and Nebraska use a small-business exemption but still bar *selling* sensitive data without consent.
- Maryland's MODPA has strict data-minimisation rules for sensitive data.
- Most of these laws require **opt-in consent for health data** when they apply.

Action: counsel to map thresholds against expected user numbers and confirm the current list. These laws have been changing every year. Status: ❌ assess.

### 3.6 State AI and mental-health laws (possible relevance)
| Law | Why it may matter | Applies? |
|---|---|---|
| Utah HB 452 (2025) — mental health chatbots (Utah Code 58-60-118, 13-72a) | Disclosure that the user is talking to AI; no sale or sharing of Utah users' health information or input. Applies if HealthMate is a "mental health chatbot" (mood tracking plus conversational AI). | Depends **[COUNSEL]** |
| Illinois HB 1806 (2025) — Wellness and Oversight for Psychological Resources Act | Restricts AI providing therapy or psychotherapy services | Depends on whether any feature is "therapy". The current product does not claim to be. |
| New York General Business Law Art. 47 — AI companions (effective Nov 5, 2025) | Crisis protocol and periodic AI disclosure for "AI companions" | Depends on the definition **[COUNSEL]** |
| Colorado AI Act (SB 24-205) | High-risk AI in "consequential decisions" (includes health care services). Effective date moved to Oct 1, 2026, and enforcement is restrained by a federal court order of Apr 27, 2026. | Unlikely for a consumer information tool; confirm |
| New York Health Information Privacy Act | Vetoed January 2025; a new bill (A10357) was introduced in 2026 | Not law as of review date; monitor |

### 3.7 State data-breach notification laws (all 50 states, DC and territories)
**Applies?** Likely. Many states include medical or health-insurance information, or account credentials, in "personal information". Each state has its own deadlines and requires notice to the state attorney general above certain counts. Coordinate with the FTC HBNR (§1.2). Status: ❌ (no plan).

### 3.8 State data-security rules
Some states require a written information-security program for residents' personal information (e.g. Massachusetts 201 CMR 17.00), and **[COUNSEL]** must confirm whether health data or the operator's size triggers them. Status: ❌ no written program.

---

## 4. FDA: medical device and clinical decision support

**Legal frame:**
- "Device" is defined in FD&C Act §201(h).
- Software functions excluded by §520(o)(1) include general wellness (B) and certain CDS (E). The CDS exclusion is for software intended for **health care professionals** who can independently review the basis. **HealthMate is consumer-facing, so the CDS exclusion is not available for its patient-facing functions.**
- FDA guidance (non-binding):
  - *Clinical Decision Support Software* (final guidance updated January 2026, with an FDA town hall on March 11, 2026);
  - *General Wellness: Policy for Low Risk Devices* (re-issued January 2026);
  - *Policy for Device Software Functions and Mobile Medical Applications*.
  - These describe what FDA treats as non-device and where it applies enforcement discretion.
- Verify the current versions; several were updated in 2026.

| Feature (code) | What it does | Regulatory question | Provisional risk | Action |
|---|---|---|---|---|
| Symptom Q&A (`chat.service.ts`, `@healthmate/safety` triage) | Deterministic triage (emergency, urgent, routine) plus an LLM answer with "possibilities", warning signs and a care level (`self_care` to `emergency`) | Does recommending a care level or listing possible conditions for a specific person's symptoms make it a device function (triage or diagnosis aid), or general information or enforcement discretion? | Medium–High | **[COUNSEL — FDA regulatory]** |
| Photo check (`analyseImage`, `IMAGE_SYSTEM_PROMPT`) | Analyses a photo of skin or a wound; returns observations, **"possibleCauses" with likelihood**, and a **care-urgency estimate** | Image analysis that suggests possible conditions resembles diagnostic software functions FDA regulates (e.g. lesion analysis) | **High** | **Candidate to disable** until assessed (see §10) |
| Report explanation (`extractReport`, `REPORT_SYSTEM_PROMPT`) | Extracts values and flags **as printed on the document** (`within_range`/`high`/`low`/`abnormal`/`not_stated`), explains what a test measures, and suggests questions for the clinician | Helping patients understand their own records may be low risk. Interpretation of a specific result toward a condition may not be. | Medium | **[COUNSEL]**. Keep flags strictly document-sourced (they are, per the prompt). Note the product rule against "abnormal" in UI copy. |
| Trends vs. personal baseline (`daily-health-context.ts`) | "In your usual range"; no clinical thresholds | Fits the general-wellness pattern if it stays non-disease-specific | Low–Medium | Keep wording rules (CLAUDE.md) |
| Medication handling | AI never changes medications or doses; this is validated in code (`ai.tasks.ts` `MEDICATION_CHANGE`, chat rules) | Lowers risk | — | Keep tests |

Also:
- **Apple Guideline 1.4.1** (medical apps get greater scrutiny; must remind users to consult a doctor; disclose methodology for accuracy claims).
- **State unlicensed-practice-of-medicine laws** — the AI must not be presented as practising medicine **[COUNSEL]**.

---

## 5. Apple: HealthKit and App Store privacy

| # | Requirement | Code status | Status |
|---|---|---|---|
| 5.1 | Guideline 5.1.1(i): privacy policy link in App Store Connect **and** in the app | iOS links are placeholders (`https://healthmate.example/...`) | ❌ |
| 5.2 | Guideline 5.1.1(v): in-app account deletion | Implemented (`POST /v1/me/delete`; iOS Settings) | ✅ code |
| 5.3 | Guideline 5.1.2(i): **clearly disclose sharing with third parties, including third-party AI, and get explicit permission first** | Consent switches exist, but the iOS onboarding copy omits external sharing and the provider isn't named (Audit §4.2) | ❌ |
| 5.4 | Guideline 5.1.2(ii): no repurposing without new consent | No secondary uses in code | ✅ code |
| 5.5 | Guideline 5.1.3(i): health/HealthKit data not used for advertising or data mining; **disclose the specific health data collected** | No ads. The list of HealthKit types (steps, heart rate, resting HR, active energy, weight, sleep) must appear in disclosures. | ⚠️ |
| 5.6 | Guideline 5.1.3(ii): no personal health information in iCloud; no false data written to HealthKit | Keychain is this-device-only; the app writes nothing to HealthKit; no iCloud use found **[FACT?]**: confirm no iCloud backup exclusions are needed for `UserDefaults` mood data | ⚠️ |
| 5.7 | HealthKit developer terms: don't disclose HealthKit data to third parties without the user's express permission, and only to parties providing a health or fitness service. Review the **Apple Developer Program License Agreement** HealthKit terms in full. | HealthKit-derived daily summaries go to the AI provider in chat context under `ai_processing` consent (Audit §4.2 G4) | ❌ |
| 5.8 | App Privacy details ("nutrition label") must match actual collection, including Health & Fitness, Sensitive Info, User Content (photos, documents, audio), Identifiers, Location (not collected by server) | No inventory yet. Use Audit §2–3. | ❌ |
| 5.9 | Privacy manifest (`PrivacyInfo.xcprivacy`) declaring required-reason APIs (e.g. `UserDefaults`) and collected data | None found | ❌ |
| 5.10 | Usage strings accurate (`project.yml`): microphone, speech, location, camera, HealthShare | Present. Speech server fallback not mentioned (Audit §9). | ⚠️ |
| 5.11 | Guideline 4.8 (login services): if Google sign-in ships on iOS, offer an equivalent privacy-focused login such as Sign in with Apple | Google not wired on iOS yet; Apple verifier not implemented | n/a now — ❗ before shipping Google on iOS |
| 5.12 | Guideline 1.4.1 medical apps (see §4) | Disclaimers present | ⚠️ |
| 5.13 | App Store age rating must match the launch scope chosen in §6.7. Apple's ratings are now 4+, 9+, 13+, 16+ and 18+. The questionnaire includes medical/wellness topics, and developers can set a higher rating to reflect a minimum age (answers were required by Jan 31, 2026 to submit updates). **The rating is not an age gate**: it does not stop a person from using the web app or creating an account. | Not in repo | ❌ |
| 5.15 | Kids-specific Apple rules if minors are enabled. Guideline 5.1.4: an app able to collect or share a minor's personal information (photos, chat, health data) needs a privacy policy and must follow children's privacy laws; birthdate and parental contact may be requested only for that purpose. Guideline 1.3: the Kids Category bars sending personal information or device information to third parties, which conflicts with sending children's data to a third-party AI. Guideline 2.3.8: "For Kids"/"For Children" metadata is reserved for the Kids Category. | No child features exist | n/a until minors are enabled — see §6 |
| 5.14 | Fact: distributing on the App Store and using the HealthKit entitlement and APNs requires Apple Developer Program membership (paid). This is a launch dependency, not a development one. | — | Op |

---

## 6. Age groups, age assurance and minors

**Product decision (2026-10-01):** HealthMate's long-term goal is to serve **children, teenagers and adults**. The age groups enabled at the initial public release are **undecided**. **No single US age rule applies nationwide.**
- Federal COPPA covers children **under 13**.
- Several states set extra duties for minors **under 18**: Connecticut, Colorado, New York, Maryland, California, Texas, Utah, Louisiana and others.
- State consumer-health-data laws (Washington, Nevada, Connecticut) apply to consumers of **any age** and say little about who consents for a minor.

### 6.1 Applies to every launch option (including adults-only)

| # | Requirement | Code status | Status |
|---|---|---|---|
| 6.1.1 | **Determine age before collecting health data**, on every sign-up path (email/password, Google, future Apple) and both platforms. Rules and documents alone do not count. | **None** (Audit §8): backend recording exists (optional `ageScreen` on sign-up and Google sign-in, `POST /v1/me/age`), but no client asks the question and nothing is checked or refused; DOB in the profile stays optional; no Declared Age Range API | ⚠️ **Blocker** (backend foundation only) |
| 6.1.2 | **Neutral age screen** (FTC COPPA FAQ). Ask for the full date of birth or age without hinting at the "right" answer (no "I am 18+" checkbox and no pre-filled adult date). Stop retries with a different age after a block (e.g. remember it on the device). Apply it before any health data is collected. | — | ❌ |
| 6.1.3 | **Handle actual knowledge of an under-13 user.** COPPA covers a general-audience service once it has **actual knowledge** that a user is under 13; a DOB showing under 13 creates that knowledge (FTC COPPA FAQ). Without parental-consent features: do not collect, delete what was collected, and record the decision without keeping health content. | DOB edits are accepted and nothing reacts | ❌ **Blocker** |
| 6.1.4 | **Handle discovered minors** outside the enabled scope: a DOB edit, a support report, an app-store age signal. Decide whether to block, delete or move them to a supported flow. | — | ❌ |
| 6.1.5 | **"Directed to children" risk from all-ages positioning.** The FTC weighs subject matter, visual content, **animated characters**, child-oriented activities, advertising and audience evidence. The "Mate" mascot and all-ages marketing could make HealthMate a **mixed-audience** service: COPPA then applies to under-13 users identified by an age screen, and before that screen only the limited information allowed by §312.5(c) may be collected (per the 2025 definition of "mixed audience"). **[COUNSEL]** | Mascot exists (`Mascot` component on the web landing page) | ❌ assess |
| 6.1.6 | **App-store age laws.** These require developers to request Apple's age category and parental-consent status, and to report significant changes; age data may only be used for age compliance and safety. Even an adults-only app must at least receive and act on the age signal **[COUNSEL]**. **Utah: the developer may not enforce its terms against a minor unless parental consent was verified through the app store.** | Not implemented: Declared Age Range API, PermissionKit Significant Change API, App Store server notifications | ❌ |
| 6.1.7 | **Web has no app-store signal.** Self-declared age plus a neutral screen is the likely baseline. From **Jan 1, 2027**, California AB 1043 (Digital Age Assurance Act) requires developers to request an age-bracket signal from operating-system providers or app stores, possibly including browsers/OS on the web **[COUNSEL]**. The FTC's age-verification policy statement (Feb 25, 2026) says it will not bring COPPA enforcement over data collected *solely* to determine age, if specific conditions are met: use only for age, prompt deletion, notice, security, accuracy. | — | ❌ |
| 6.1.8 | **App Store age rating** matches the chosen scope (§5.13). It is not a substitute for 6.1.1. | — | ❌ |

The app-store age laws in 6.1.6:
- **Texas SB 2420**: in force for new Texas Apple Accounts from **June 4, 2026**, per Apple's developer news.
- **Utah SB 142** (Utah Code 13-76; developer duties from **May 6, 2026**).
- **Louisiana HB 570** (Act 481 of 2025; effective date **unconfirmed**, reported as July 1, 2026).
- These laws are new and some face litigation. Confirm the current status.

### 6.2 Children under 13

**Applies?** Yes, the moment any under-13 user is knowingly allowed or the service is directed to children. COPPA, 16 CFR Part 312: the amended rule took effect **June 23, 2025**, and most obligations had a compliance date of **April 22, 2026**.

| # | Requirement | Notes | Code status |
|---|---|---|---|
| 6.2.1 | **Scope** | COPPA covers personal information *collected from* a child. Under the rule this includes: name, contact details, photos, video and audio with the child's image or voice, geolocation, persistent identifiers and (since 2025) biometric identifiers. Free-text health details count when combined with identifiers. **Information a parent enters about their child is generally not "collected from a child"**, but it is still consumer health data under state laws **[COUNSEL]**. | ❌ none |
| 6.2.2 | **Direct notice to parents** before collection, and an online notice: what is collected, how it is used and disclosed, **the identities or categories of third parties**, the **written data-retention policy**, and parental rights | ‹TBD›; drafting is counsel's job | ❌ |
| 6.2.3 | **Verifiable parental consent (VPC)** before collecting from the child, through an FTC-recognised method. Examples include a signed form, a payment transaction, a call or video call with trained staff, and a government ID check. The 2025 amendments added further methods (e.g. knowledge-based questions, a face match to a photo ID, and "text plus") — **verify the final list**. "Email plus" is limited to internal uses. | Needs identity, a consent ledger, revocation and audit. A paid verification vendor may be needed **[FACT?]**. | ❌ **Blocker** |
| 6.2.4 | **Separate VPC for disclosures to third parties** that are not integral to the service (2025 amendment) | **Key question:** is the AI provider a third party whose disclosure needs separate consent, or a service provider whose processing is integral? Either way the notice must name the disclosure **[COUNSEL]**. | ❌ |
| 6.2.5 | **Parent rights**: review the child's personal information, revoke consent, have it deleted, and refuse further collection while still allowing participation where possible | Needs a parent account linked to the child and verified as the parent | ❌ |
| 6.2.6 | **Data minimisation**: no conditioning participation on more data than reasonably necessary | e.g. no exact DOB to the AI; no long-term memory by default; no photos of the child unless essential | ❌ |
| 6.2.7 | **Written data-retention policy** (2025 amendment): keep data only as long as reasonably necessary for the documented purpose, publish the policy in the notice, **no indefinite retention** | Today health data is kept until the user deletes it (Audit §5), which is incompatible for under-13 data | ❌ **Blocker** |
| 6.2.8 | **Written information security program** (amended §312.8), with reasonable steps to release data only to providers able to protect it | No written program (Audit §7) | ❌ |
| 6.2.9 | **Voice**: the FTC has treated audio used only to replace typed words and promptly deleted as an exception (2017 enforcement policy statement, reflected in later rulemaking — **verify current status**). iOS speech may be processed by Apple's servers when on-device recognition is unavailable (Audit §3). | — | ❌ verify |
| 6.2.10 | **Apple**: Guideline 5.1.4 (above). The Kids Category is incompatible with sending children's data to a third-party AI (Guideline 1.3), so don't list HealthMate in it. Non-Kids apps must not market themselves as "for kids" (Guideline 2.3.8). | — | n/a |
| 6.2.11 | **States**: New York's Child Data Protection Act (effective **June 20, 2025**) requires **parental** informed consent for users under 13 when processing isn't strictly necessary. Maryland and California age-appropriate design codes cover under-18s generally (§6.3). | — | ❌ |

### 6.3 Teenagers 13–17

COPPA does not cover teens. Obligations come from a **patchwork of state laws** (most apply with *actual knowledge*, or *willful disregard*, that a user is a minor) plus app-store age laws.

| # | Law / topic | What it requires (summary — confirm text) | Applies? | Status |
|---|---|---|---|---|
| 6.3.1 | **Connecticut CTDPA minors' provisions** (under 18; effective Oct 1, 2024; amended 2025 and later — verify, including Public Act 26-64) | Reasonable care to avoid a "heightened risk of harm to minors"; data-protection assessment; **no targeted advertising or sale**; consent for certain processing such as profiling; limits on precise geolocation | Likely, for known minors in Connecticut | ❌ |
| 6.3.2 | **Colorado Privacy Act minors' amendments** (SB 24-041, effective **Oct 1, 2025**) | Similar duty of care and assessment; consent to process minors' data for targeted ads, for longer than necessary, or for undisclosed purposes | Depends on Colorado Privacy Act thresholds **[COUNSEL]** | ❌ |
| 6.3.3 | **New York Child Data Protection Act** (effective June 20, 2025) | For 13–17-year-olds: process personal data only when **strictly necessary** for listed purposes or with the **teen's informed consent**. AG guidance exists. | Likely, with actual knowledge of a New York minor | ❌ |
| 6.3.4 | **Maryland Age-Appropriate Design Code** (effective Oct 1, 2024) | Best-interests duty for products "reasonably likely to be accessed by children" (under 18); data-protection impact assessments; high-privacy defaults | Depends on thresholds and coverage **[COUNSEL]** | ❌ |
| 6.3.5 | **California Age-Appropriate Design Code** (in litigation: on Mar 12, 2026 the 9th Circuit left some provisions enjoined, including data-use and dark-patterns restrictions, and lifted others, including coverage and age estimation) | DPIAs, age estimation, defaults. Depends on CCPA thresholds. | Depends **[COUNSEL]** | ❌ |
| 6.3.6 | **CCPA** (if thresholds are met) | Opt-in before selling or sharing data of consumers under 16 | Depends | ✅ code (no sale or sharing for ads) |
| 6.3.7 | **Texas SCOPE Act** (HB 18, effective Sept 1, 2024; parts were enjoined in 2024 — verify) | Duties for "digital service providers" toward known minors; limits on collecting and sharing their personal information. Coverage turns on social-interaction features, which HealthMate does not have. | Probably not; confirm | — |
| 6.3.8 | **App-store age laws** (§6.1.6) | iOS teens in Texas, Utah and Louisiana need app-store parental consent for downloads and significant changes | Likely for iOS | ❌ |
| 6.3.9 | **State consumer-health-data laws** (Washington, Nevada, Connecticut) | Apply to teens as consumers. Washington's MHMDA does not say whether a parent or the teen consents for a minor **[COUNSEL]**. | Likely | ❌ |
| 6.3.10 | **AI and mental-health laws**: California SB 243 has extra duties toward known minors (AI disclosure, break reminders, content limits); NY GBL Art. 47; Utah HB 452 | Turns on the companion or mental-health chatbot definitions (§3.6) | Depends **[COUNSEL]** | ❌ |
| 6.3.11 | **Other states** | Vermont and Nebraska enacted design-code or minors' laws in 2025, and more are pending. **Not verified in this review.** | Monitor | — |

**Teen-specific design and confidentiality questions [COUNSEL + clinical]:**
- **Confidentiality vs. parental access.** State minor-consent laws let teens consent to some care themselves (often sexual and reproductive health, mental health, substance use) and can protect that information from parents. HealthMate is not a care provider, but a future parent dashboard could expose exactly that information. Decide what a parent can see, per state and per topic, before building parent access for teens.
- **Sensitive conversations.**
  - Self-harm, eating disorders, pregnancy, contraception, sexual health, substance use, abuse or neglect, and gender-related care (where some states restrict care for minors).
  - Today the self-harm rule escalates deterministically (`packages/safety/src/rules.ts` `self-harm-or-suicidal-intent`) and links to findahelpline.com.
  - Questions: whether teen-specific crisis resources are needed, and **whether any reporting duty arises** if a minor discloses abuse (HealthMate is generally not a mandated reporter, but confirm).
- **Age-appropriate design.** No engagement-maximising features or streak pressure for minors, high-privacy defaults, plain-language notices a teen can understand, and no profiling. Long-term memory is a form of profile.
- **Turning 18.** Data collected as a minor should be reviewed when the user reaches majority (offer review and deletion; switch consent to the adult).

### 6.4 Adults 18+

| # | Item | Status |
|---|---|---|
| 6.4.1 | Everything else in this checklist (§1–5, §7–10) applies | See sections |
| 6.4.2 | Age screen confirms 18+; adult consent flows (Audit §4.2 gaps G3 and G4 still open; G6 fixed 2026-10-02) | ❌ |
| 6.4.3 | If adults later manage a child's or teen's data (caregiver or dependent profiles): parent-entered data about a child is generally outside COPPA but is still consumer health data. Needs proof of authority, then handling at 18 or when custody changes. | Not built; the data model is single-user |

### 6.5 Can HealthMate safely process minors' data today? Feature-by-feature

Assessment of **current code** (Audit §4, §8). "Today" means as the code stands. No child-specific safeguard exists in any feature.

| Feature | What happens today | Minor-specific risk | Safe for minors now? | Needed before enabling |
|---|---|---|---|---|
| **Medical reports** | Whole file sent unredacted to the AI provider when one is configured; stored indefinitely | A child's identifiers and diagnoses go to a third party; COPPA third-party disclosure; retention limits | **No** | Parental consent covering *this* processing and disclosure; redaction or minimisation; retention limits; a provider whose terms allow minors' data **[FACT?]**; FDA view (§4) |
| **Health images** | Photo sent to the AI provider. The prompt marks genitals and other areas unsupported, but **the image is still uploaded, stored and sent first** | Photos of a child's body; risk of intimate images of minors (federal reporting duties for child sexual abuse material **[COUNSEL]**); COPPA treats photos of a child as personal information | **No — highest risk** | Keep disabled for minors at first; if ever enabled: screening before upload/sending, parental consent, minimal retention |
| **Symptom conversations** | LLM answers with adult-oriented prompts; deterministic triage rules are **pending clinical review** and **not pediatric** (`rules.ts` header) | Pediatric red flags (e.g. infant fever, dehydration, dosing by weight) aren't covered; sensitive teen topics; AI not tuned for age | **No** | Pediatric clinical review of the triage rules; age-aware prompts and content policy; crisis pathways for teens; parental consent for under-13 |
| **Apple Health data** | Daily aggregates synced (with `health_data_sync` consent); summaries go to the AI in chat context | Data collected from a child's device is "collected from a child"; Apple 5.1.3 and HealthKit rules | **No** | Per-purpose consent (sync vs. AI); parental consent for under-13 |
| **Long-term health memory** | Facts kept until deleted; embeddings; AI inferences stored as `ai_inferred` | Profiling of minors (Connecticut and Colorado limits); COPPA retention; data following the child into adulthood | **No** | Off by default for minors, or short retention; review and deletion at 18 |
| **Disclosure to AI providers in general** | Profile summary includes the **exact date of birth**, so the provider can infer that the user is a child | Children's data reaches a third party; the provider's usage policy on minors is **not reviewed [FACT?]** | **No** | Review the provider's terms on minors; send an age band, not DOB; parental consent to that disclosure, separate if counsel says COPPA requires it |

**Does parental consent need to cover each processing or disclosure purpose?**
- For under-13 users, COPPA requires the notice to describe each collection, use and disclosure. Since 2025 it requires a **separate** consent for disclosure to third parties that is not integral to the service.
- Recommendation for design, pending counsel: **granular parental consent for each purpose**: account and record keeping; AI chat; report analysis; photo analysis; Apple Health sync; Apple Health in AI; long-term memory; voice.
- Each item should be revocable on its own, and revoking it should stop **queued** jobs too. Queued work now honours withdrawal of the account holder's consent (Audit §4.2, 2026-10-02); per-purpose parental revocation does not exist yet.

### 6.6 Implementation needs by age group (none exist in code)

| Capability | 18+ only launch | Adds 13–17 | Adds under 13 |
|---|---|---|---|
| Neutral age screen on all sign-up paths (web + iOS + OAuth) | Required | Required | Required |
| Apple Declared Age Range + PermissionKit significant-change + server notifications | Required (to receive and act on signals) **[COUNSEL]** | Required | Required |
| Age stored as a band, with re-check on DOB edits | Required | Required | Required |
| Block/delete flow for out-of-scope ages | Required | Required | — |
| Age-aware AI prompts, content policy, pediatric/teen clinical review of triage | — | Required | Required |
| Teen consent and notices; high-privacy defaults; no profiling; memory limits | — | Required | Required |
| Parent and guardian accounts linked to the child, with proof of authority | — | Decision (state-specific confidentiality) | Required |
| Verifiable parental consent (FTC method), consent ledger, revocation | — | — | Required |
| Parent review, export and deletion of the child's data | — | Optional / state-specific | Required |
| Written retention policy with automatic deletion for children's data | Recommended | Required (CT, CO) | Required (COPPA) |
| Written information-security program | Recommended | Required | Required (COPPA §312.8) |
| Feature gating by age (photos, memory, Apple Health in AI) | — | Required | Required |
| Provider review of minors' data (AI provider terms) | — | Required | Required |

### 6.7 Staged launch strategy (decision required)

| | **Option A — Adults-only first, then a minors-capable release** | **Option B — Teens + adults first; under-13 deferred** | **Option C — All ages at launch with parental consent** |
|---|---|---|---|
| Fit with the all-ages vision | Partial at launch; staged | Closer | Full |
| New legal surface at launch | Smallest: COPPA actual-knowledge handling, app-store age laws, adult consent gaps | Adds the state minors' laws (CT, CO, NY, MD, CA design code), app-store parental consent, teen confidentiality questions | Adds all of COPPA (notice, VPC, separate third-party consent, parent rights, retention, security program) on top of B |
| Engineering before launch | Age screen, signal handling, block/delete flow | A + age-aware AI and content, teen consents and defaults, feature gating, teen clinical review | B + parent accounts, VPC, parent dashboard, granular consents, retention automation, provider review |
| Clinical work | Adult triage review (already pending) | + adolescent review | + pediatric review |
| Risk of claiming safeguards that don't exist | Low | Medium | High unless every item in §6.8 is built and tested |
| Main risk | All-ages marketing or the mascot could make the service mixed-audience (§6.1.5); minors who lie about age | Confidentiality and sensitive topics; state law changing fast | Cost and complexity of VPC for an individual developer; children's data sent to a third-party AI |
| Reversibility | Easy to widen later | Moderate | Hard to roll back (children's data already collected) |

**6.7.4 Recommendation (for operator and counsel to confirm): Option A, designed to grow into B and then C.**
1. **Initial release: 18+ only, as a launch scope rather than a permanent policy.** Ship the neutral age screen on every path, act on Apple age signals, and block and delete out-of-scope sign-ups. Keep marketing and App Store metadata adult-directed until minors are supported.
2. **Build the data model for the future now (design only).** Age band per account; optional parent link; per-purpose consent records tied to the shown text; retention policies per age group. Then minors can be enabled without migrating live data.
3. **Release 2 — teens (Option B)** once §6.8 items M1–M12 and M14–M16 are done: state-law map, teen consents and defaults, age-aware AI and content policy, adolescent clinical review, app-store parental-consent flows, and photo and memory limits.
4. **Release 3 — under 13 (Option C)** once COPPA VPC, parent rights, separate third-party consent, the written retention policy and the security program exist and have been reviewed by counsel (§6.8 M13 and later).

Why: the vision is preserved, minors' data is not collected before child safeguards exist, and none of the current gaps (Audit §8) are hidden.

### 6.8 Minors: Launch Blockers and Required Safeguards

**None of these exist in the code today** (Audit §8). Existing findings stay open: no age checks on any path (Audit G1) and adult consent gaps (G3, G4). G6 (queued work after withdrawal) was fixed on 2026-10-02. A blocker marked for an age group must be resolved before that group is enabled. "All" means it blocks every launch option, including adults-only.

| # | Blocker / safeguard | Blocks | Owner |
|---|---|---|---|
| M1 | Decide the initial launch scope (§6.7) and record it | All | Op + Lawyer |
| M2 | Neutral age screen before health data collection, on every sign-up path and platform. *Backend contract and recording exist (2026-10-02); no client screen yet; Supabase sign-ups that bypass the API stay `unknown`.* | All | Eng |
| M3 | Act on app-store age signals and parental-consent status (Texas, Utah, Louisiana); handle consent-revocation notifications | All (iOS) | Eng + Lawyer |
| M4 | Under-13 handling: refuse or route to a supported flow, delete data collected without VPC, record the decision without health content | All | Eng |
| M5 | Re-check age on DOB edits and other signals; block/delete flow for out-of-scope ages. *Implemented so far (2026-10-02): a review policy, where an older band than the one on record is held as `review`; profile DOB edits don't change the band. No block or delete flow.* | All | Eng |
| M6 | Marketing, App Store metadata and mascot use consistent with the chosen scope (mixed-audience analysis) | All | Op + Lawyer |
| M7 | State minors'-law map (CT, CO, NY, MD, CA, TX, UT, LA and others) with the obligations per enabled age group | 13–17, <13 | Lawyer |
| M8 | Age-aware AI behaviour: prompts, content policy and refusal rules for minors; no adult-only content | 13–17, <13 | Eng + clinical |
| M9 | Pediatric and adolescent clinical review of triage rules and crisis pathways (rules are pending clinical review even for adults) | 13–17, <13 | Clinical |
| M10 | Feature gating by age: photo analysis off for minors at first; long-term memory off by default or time-limited; Apple Health-in-AI off unless consented | 13–17, <13 | Eng |
| M11 | Data minimisation to AI: age band instead of DOB; document redaction; review of the AI provider's terms on minors' data | 13–17, <13 | Eng + Lawyer |
| M12 | Teen consents in age-appropriate language; high-privacy defaults; no profiling or targeted ads; decision on parental visibility (confidentiality) | 13–17 | Lawyer + Eng |
| M13 | COPPA: direct and online notice, **verifiable parental consent**, **separate consent for non-integral third-party disclosure** (incl. the AI provider if counsel so concludes), parent review, export, deletion and revocation | <13 | Eng + Lawyer |
| M14 | Written data-retention policy with automatic deletion for minors' data (COPPA for <13; CT/CO "no longer than necessary") | 13–17, <13 | Op + Eng |
| M15 | Written information-security program (COPPA §312.8; also good practice for all ages) | 13–17, <13 | Op |
| M16 | Withdrawal of consent stops queued processing — **implemented 2026-10-02** for the account holder's consent (Audit G6). In-flight provider calls can't be recalled. Parental-consent revocation does not exist yet. | All (worse for minors) | Eng |
| M17 | Parent and guardian accounts with proof of authority, if caregiver use is in scope | Product-dependent | Eng + Lawyer |
| M18 | Turning-18 transition: re-consent, review and deletion offer | 13–17 | Eng |
| M19 | Incident plan covering minors (notices to parents for <13; state AG duties) | 13–17, <13 | Op + Lawyer |
| M20 | Automated tests for every age rule and safeguard (CLAUDE.md requires tests for all safety behaviour) | All | Eng |

---

## 7. Account deletion, privacy rights, retention, incidents, support

| # | Requirement | Code status | Status |
|---|---|---|---|
| 7.1 | In-app deletion (Apple) plus a web path | Both exist | ✅ code |
| 7.2 | Deletion scope disclosed: what is deleted immediately, what stays (operational records, backups, provider copies) and for how long | Residue exists (Audit §6). No disclosure. | ❌ |
| 7.3 | Access/export in a portable format, including uploaded files and the third-party list | JSON export exists; files and list missing | ⚠️ |
| 7.4 | Correction | Exists | ✅ code |
| 7.5 | Request intake for people who can't use the app (email or form), identity verification, response clock, appeal (state laws) | No contact channel exists | ❌ **Blocker** |
| 7.6 | Retention schedule per data category | Health data indefinite; operational defaults are placeholders (Audit §5) | ❌ |
| 7.7 | Security incident procedure (§1.2, §3.7) | None | ❌ **Blocker** |
| 7.8 | Support contact (Apple requires a Support URL; consumer laws expect a contact). **No support email, address or entity is defined.** This audit does not invent one. | — | ❌ **Blocker** |
| 7.9 | Logs minimised (CLAUDE.md "Minimize health content in logs") | Mostly ✅. Error filter gap (Audit G7). | ⚠️ |
| 7.10 | Device-local data cleared on sign-out/deletion | **[FACT?]** | ❌ verify |

---

## 8. Data sent to external AI before launch

| # | Requirement | Status |
|---|---|---|
| 8.1 | Development continues without paid AI or real health data externally: `AI_PROVIDER=development` is offline and refused in production (Audit §4.1) | ✅ |
| 8.2 | Before enabling **any** external AI with real users: review provider terms (retention, training use, zero-data-retention options, subprocessors, location, breach notice, BAA availability if ever needed); name the provider in disclosures; separate sharing consent; HealthKit permission; data minimisation (e.g. age instead of DOB; redaction of document identifiers) | ❌ |
| 8.3 | Confirm no real health data has been sent to an external AI during development (operator attestation; check whether `ANTHROPIC_API_KEY` was ever set with real data) | **[FACT?]** Op |

---

## 9. Paid features (if introduced later)

| Requirement | Notes |
|---|---|
| Apple In-App Purchase rules (Guidelines 3.1.1, 3.1.2 auto-renewing subscriptions) for digital features on iOS | Apple handles billing and cancellation on iOS |
| ROSCA (15 U.S.C. §§8401–8405): clear disclosure of material terms, express informed consent, simple cancellation for online negative-option programs | The FTC's 2024 "click-to-cancel" amendments were **vacated by the 8th Circuit on July 8, 2025**. ROSCA still applies. |
| State automatic-renewal laws (e.g. California ARL) | Web subscriptions especially |
| Refund terms consistent with Apple's policies (iOS) and the web processor | Not defined |
| Sales tax / payment processor KYC | The individual developer's tax status **[COUNSEL]** |
| Budget limits disclosed honestly (internal AI cost limit exists: `AI_MONTHLY_USER_BUDGET_USD`; urgent requests have a separate capped allowance) | If paid tiers change limits, describe them truthfully |

---

## 10. Additional items for an individual developer serving US consumers

| # | Item | Why | Owner |
|---|---|---|---|
| 10.1 | **Business entity** (e.g. an LLC) before launch | Personal liability exposure; contract counterparty for providers; App Store seller name **[COUNSEL]** | Op + Lawyer |
| 10.2 | **Insurance**: cyber/privacy liability and technology errors & omissions (possibly professional liability) | Health data breach costs; AI-advice claims | Op |
| 10.3 | Terms of Service enforceability: clickwrap with recorded acceptance (version, timestamp); arbitration/class-waiver choices; governing law; limitation of liability for health information | Acceptance isn't recorded today (Audit §9) | Lawyer + Eng |
| 10.4 | Accessibility (ADA Title III for websites and apps; state law) | Litigation risk | Lawyer |
| 10.5 | Unlicensed practice of medicine; telehealth laws if clinicians are ever added | AI health guidance | Lawyer |
| 10.6 | Emergency-services representations: the app shows emergency guidance and a call button (`CareScreens.swift` `tel://`); confirm the disclaimers about reliability | Life-safety | Lawyer |
| 10.7 | Email deliverability and content (Supabase Auth emails): transactional only; CAN-SPAM if anything promotional is ever sent | — | Op |
| 10.8 | Export controls/sanctions screening for a US-only launch (limit App Store territories to the US) | Simplifies international-transfer questions | Op |
| 10.9 | Record-keeping: consent records tied to the exact text shown (today only `version="2026-09"` is stored) | Proof of consent | Eng |
| 10.10 | Vendor due diligence file per processor (Audit §3) | MHMDA, HBNR, FTC | Op |

---

## 11. Features to disable until requirements are resolved

| Feature | Disable / gate until | Reason |
|---|---|---|
| **Any external AI provider with real user data** (chat, reports, photos) | 8.2 done, consent copy updated, provider terms reviewed, Privacy Policy and Consumer Health Data Privacy Policy published | Apple 5.1.2(i), MHMDA/NV/CT sharing consent, HBNR unauthorized-disclosure risk |
| **Photo check (image analysis)**, especially "possible causes" and urgency estimates | FDA regulatory assessment (§4) | Highest device-classification risk |
| **Report analysis** | FDA assessment (§4) and the data-minimisation decision (redaction) | Medium device risk; whole documents sent unredacted |
| **HealthKit data in AI context** | HealthKit-specific disclosure and permission (§5.7) | Apple terms |
| **Public sign-up** (web and iOS) | Age screen and handling for the chosen launch scope (§6.1, §6.8 M1–M6), Terms + Privacy Policy published with acceptance recorded (§10.3), support/request channel (§7.5, §7.8), breach plan (§1.2) | Blockers |
| **Any access by users under 18** (all features) | The §6.8 items for that age group are complete and reviewed by counsel. Today no child or teen safeguard exists. | Minors' laws; COPPA |
| **Photo analysis for minors** | Kept off for minors even after teen launch until §6.5 conditions are met | Highest-risk minor flow |
| **Long-term memory and Apple Health-in-AI for minors** | Age-specific retention and consent (§6.5, M10, M14) | Profiling and retention limits |
| **Web preview/demo mode on any public deployment** | Explicit demo deployment with the notice, no real accounts, `/preview/inbox` not public | Audit G11 |
| **Google sign-in on iOS** | Sign in with Apple available (Guideline 4.8) and the age gate covers OAuth sign-up | Apple + age |
| **Push with "show details"** | Disclosure that notification text passes through Apple | Privacy notice |

---

## 12. Sources (official; reviewed 2026-10-01)

Direct fetches of ftc.gov and leg.wa.gov were blocked from the audit environment. Those entries were confirmed through official-domain search results only and must be re-read in full by counsel.

| Topic | Source | Reviewed |
|---|---|---|
| FTC HBNR (rule text) | https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318 | 2026-10-01 |
| FTC HBNR 2024 final rule (FR, 2024-05-30; effective 2024-07-29) | https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule | 2026-10-01 |
| FTC HBNR overview | https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule | 2026-10-01 (search only) |
| FTC: Complying with the HBNR | https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0 | 2026-10-01 (search only) |
| FTC GoodRx enforcement | https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising | 2026-10-01 (search only) |
| FTC Act §5 | https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title15-section45 | Not fetched — verify |
| FTC Health Products Compliance Guidance | https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance | Not fetched — verify |
| HHS: HIPAA & Health Apps | https://www.hhs.gov/hipaa/for-professionals/special-topics/health-apps/index.html | 2026-10-01 (search only) |
| HHS: Access right, health apps & APIs | https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access-right-health-apps-apis/index.html | 2026-10-01 (search only) |
| HHS: Health app use scenarios (2016) | https://www.hhs.gov/sites/default/files/ocr-health-app-developer-scenarios-2-2016.pdf | 2026-10-01 (search only) |
| Washington MHMDA (RCW 19.373) | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373&full=true | 2026-10-01 (search only) |
| Nevada SB 370 (2023) / NRS 603A | https://www.leg.state.nv.us/Session/82nd2023/Bills/SB/SB370_EN.pdf ; https://www.leg.state.nv.us/nrs/nrs-603a.html | 2026-10-01 (search only) |
| Connecticut Data Privacy Act (AG overview; statute) | https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act ; https://www.cga.ct.gov/current/pub/chap_743jj.htm ; PA 26-64: https://www.cga.ct.gov/2026/act/pa/pdf/2026PA-00064-R00SB-00004-PA.pdf | 2026-10-01 (search only) |
| California CMIA §56.06 | https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=56.06. | 2026-10-01 (search only) |
| California CCPA (AG) | https://oag.ca.gov/privacy/ccpa | Not fetched — verify |
| California AB 489 (2025) | https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB489 | 2026-10-01 (search only) |
| California SB 243 (2025) | https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260SB243 | 2026-10-01 (search only) |
| Utah HB 452 (2025), mental health chatbots | https://le.utah.gov/Session/2025/bills/enrolled/HB0452.pdf ; https://commerce.utah.gov/dopl/mental-health-chatbot/ | 2026-10-01 (search only) |
| Illinois HB 1806 (2025) | https://ilga.gov/documents/legislation/104/HB/10400HB1806.htm | 2026-10-01 (search only) |
| New York GBL Art. 47 (AI companions) | https://www.governor.ny.gov/news/governor-hochul-pens-letter-ai-companion-companies-notifying-them-safeguard-requirements-are | 2026-10-01 (search only) |
| New York HIPA veto / A10357 | https://www.nysenate.gov/newsroom/press-releases/2025/liz-krueger/statement-senator-liz-krueger-and-assemblymember-linda ; https://www.nysenate.gov/legislation/bills/2025/A10357 | 2026-10-01 (search only) |
| Colorado AI Act (SB 24-205) | https://leg.colorado.gov/bills/sb24-205 | 2026-10-01 (search only) |
| FDA CDS guidance (2026) | https://www.fda.gov/media/191560/download ; town hall: https://www.fda.gov/medical-devices/medical-devices-news-and-events/town-hall-clinical-decision-support-software-final-guidance-03112026 | 2026-10-01 (search only) |
| FDA guidances with digital health content (General Wellness, Device Software Functions & MMA) | https://www.fda.gov/medical-devices/digital-health-center-excellence/guidances-digital-health-content ; https://www.fda.gov/media/80958/download | 2026-10-01 (search only) |
| Apple App Review Guidelines (1.4.1, 4.8, 5.1.1, 5.1.2, 5.1.3) | https://developer.apple.com/app-store/review/guidelines/ | 2026-10-01 (fetched; page shows no date) |
| Apple: App privacy details | https://developer.apple.com/app-store/app-privacy-details/ | 2026-10-01 (search only) |
| Apple: Authorizing access to health data (HealthKit) | https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data | 2026-10-01 (search only) |
| Apple: Texas SB 2420 update (posted 2026-06-03) | https://developer.apple.com/news/?id=sg176nne | 2026-10-01 (fetched) |
| Apple: Age assurance Q&A | https://developer.apple.com/support/age-assurance/ | 2026-10-01 (search only) |
| COPPA amended rule (FR 2025-04-22; effective 2025-06-23; compliance 2026-04-22) | https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule | 2026-10-01 (search only) |
| FTC: COPPA amendments press release (Jan 2025) | https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data | 2026-10-01 (search only) |
| COPPA rule text (16 CFR Part 312) | https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312 | Not fetched — verify |
| FTC: Complying with COPPA — FAQ (actual knowledge, neutral age screens) | https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions | 2026-10-01 (search only) |
| FTC: COPPA six-step compliance plan | https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-six-step-compliance-plan-your-business | 2026-10-01 (search only) |
| FTC: COPPA age-verification enforcement policy statement (Feb 25, 2026) | https://www.ftc.gov/legal-library/browse/enforcement-policy-statement-promoting-adoption-age-verification-technology | 2026-10-01 (search only) |
| FTC: 6(b) inquiry into AI companion chatbots and children/teens (Sept 2025) | https://www.ftc.gov/news-events/news/press-releases/2025/09/ftc-launches-inquiry-ai-chatbots-acting-companions | 2026-10-01 (search only) |
| Apple: Kids apps and parental gates | https://developer.apple.com/app-store/kids-apps/ | Linked from the guidelines; not fetched |
| Apple: App Review Guidelines 1.3, 2.3.8, 5.1.4 | https://developer.apple.com/app-store/review/guidelines/ | 2026-10-01 (fetched) |
| Apple: Updated age ratings (13+/16+/18+; answers required by Jan 31, 2026) | https://developer.apple.com/news/upcoming-requirements/?id=07242025a | 2026-10-01 (search only) |
| Apple: Declared Age Range API | https://developer.apple.com/documentation/declaredagerange/ | Linked from the Apple Texas update (fetched) |
| Utah SB 142 App Store Accountability Act (Utah Code 13-76; developer duties from May 6, 2026) | https://le.utah.gov/Session/2025/bills/enrolled/SB0142.pdf | 2026-10-01 (search only) |
| Louisiana HB 570 (Act 481 of 2025) | https://www.legis.la.gov/legis/ViewDocument.aspx?d=1425304 | 2026-10-01 (search only; effective date unconfirmed) |
| California AB 1043 Digital Age Assurance Act (operative Jan 1, 2027) | https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202520260AB1043 | 2026-10-01 (search only) |
| NY Child Data Protection Act — AG guidance (effective June 20, 2025) | https://ag.ny.gov/child-data-protection-act-guidance | 2026-10-01 (search only) |
| Connecticut CTDPA minors' provisions (AG overview) | https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act | 2026-10-01 (search only) |
| Colorado SB 24-041 minors' protections (effective Oct 1, 2025) | https://leg.colorado.gov/bills/sb24-041 | 2026-10-01 (search only) |
| Maryland Age-Appropriate Design Code (HB 603, 2024; effective Oct 1, 2024) | https://mgaleg.maryland.gov/mgawebsite/Legislation/Details/hb0603?ys=2024RS | 2026-10-01 (search only) |
| California AADC litigation — NetChoice v. Bonta (9th Cir., Mar 12, 2026) | https://cdn.ca9.uscourts.gov/datastore/opinions/2026/03/12/25-2366.pdf | 2026-10-01 (search only) |
| Texas SCOPE Act (HB 18; AG page) | https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-privacy-rights/securing-children-online-through-parental-empowerment | 2026-10-01 (search only) |
| FTC Negative Option Rule vacatur (8th Cir., 2025-07-08) / ROSCA | https://www.ftc.gov/news-events/news/press-releases/2024/10/federal-trade-commission-announces-final-click-cancel-rule-making-it-easier-consumers-end-recurring | 2026-10-01 (search only) |

**Laws whose applicability depends on facts not yet established:**
- CCPA (thresholds);
- CMIA §56.06 (deemed-provider status);
- HIPAA (any B2B relationship);
- comprehensive state laws (thresholds);
- SB 243, NY Art. 47, Utah HB 452 and Illinois HB 1806 (feature definitions);
- Colorado AI Act;
- FDA device status (intended use and claims);
- state app-store age laws (obligations depend on the chosen age scope);
- state minors' privacy and design-code laws (thresholds, actual knowledge and litigation status);
- whether the AI provider is a COPPA "third party" needing separate parental consent;
- whether all-ages positioning makes HealthMate "directed to children" or mixed-audience.
