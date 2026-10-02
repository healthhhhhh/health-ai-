# Security Incident and Breach-Response Procedure — DRAFT (internal)

> **Unpublished internal draft for counsel review. Not legal advice.** See `README.md`.
> Legal notification duties depend on facts and on each affected person's state; every "notify" step
> below needs counsel's decision at the time. [[COUNSEL: FTC Health Breach Notification Rule
> (16 CFR 318) applicability; state breach laws; WA/NV consumer-health-data duties; HIPAA analysis
> (do not assume it applies or doesn't).]]

## Roles and contacts
- Incident lead: [[OWNER: name, phone]] · Backup: [[OWNER]]
- Counsel: [[OWNER: firm/contact]] · Hosting/Supabase support: [[DEPLOY]] · AI provider security contact: [[OWNER]]
- Security reports inbox: [[OWNER: security@ address / disclosure page — doesn't exist yet]]

## 1. Detect and record (hour 0)
Open an incident record [[OWNER: location]] with time found, who found it, what is known. **Don't copy
health data into the record, chat or tickets** — refer to row ids and counts.

## 2. Contain (first hours)
- Rotate exposed secrets: Supabase secret key, `JWT_SECRET`, `PUSH_TOKEN_KEY`, `EMBED_FUNCTION_SECRET`,
  AI provider key, APNs key. [[OWNER: rotation runbook — doesn't exist yet]]
- Revoke sessions if accounts may be compromised (Supabase Auth sign-out; local refresh-token revocation).
- Turn off affected features by configuration (e.g. `AI_PROVIDER=none`), block abusive traffic.
- Preserve evidence: platform logs, database audit (`audit_logs`), access logs — before retention expires.

## 3. Assess (within [[COUNSEL]] hours)
- What data, whose, how many people, which states (from account time zone/state if known [[OWNER: we
  don't collect state of residence — decide how to determine it]]).
- Was it acquired without authorisation? Encrypted? Includes minors (13–17)? Includes consumer health data?
- Which third parties are involved (processor breach vs ours).

## 4. Decide and notify (counsel-led)
| Who | When it may be required | Deadline (verify at the time) |
|---|---|---|
| Affected individuals | FTC HBNR if it applies; state breach laws; WA/NV health-data laws | HBNR: without unreasonable delay, ≤ 60 days after discovery |
| FTC | HBNR: ≥ 500 people — at the same time as individuals; < 500 — annual log | per rule |
| Media | HBNR: ≥ 500 residents of one state | per rule |
| State attorneys general | Many state laws above thresholds | per state |
| Apple / Google | Store and HealthKit terms | per agreement |
Notices must be in plain language and must not include more health data than needed.

## 5. Recover and review
Fix the cause, add a regression test, document the timeline and decisions, and update the audit and
these policies. Review within [[OWNER]] days.

## 6. Preparation still missing (launch blockers)
Security contact and disclosure page; secret-rotation runbook; access review; backup/restore test;
a way to know affected people's states; counsel on call; this document approved.
