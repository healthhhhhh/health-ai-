# Data Retention, Deletion and Privacy-Request Procedure — DRAFT

> **Unpublished draft for counsel review. Not legal advice. Not in force.** See `README.md`.
> Part A is public-facing. Part B is the internal procedure. Periods marked "default" are engineering
> placeholders in configuration, **not** decided legal retention periods. [[COUNSEL/OWNER: decide each.]]

## Part A — What we keep and for how long (public)

| Data | Kept | After you delete it / your account |
|---|---|---|
| Health record, conversations, memories, reports, photos, tracking, Apple Health data | Until you delete it or your account | Removed from the live database and file storage at once (file storage first; an interrupted deletion is completed automatically within minutes) |
| Photo notes | Until the photo's analysis is saved | — |
| Age band, age history, date of turning 18 (13–17 only) | While the account exists | Removed with the account |
| Under-13 accounts | Locked when found; deleted after [[OWNER/COUNSEL: hold; default 72 hours]] | — |
| Permission history | While the account exists | Removed with the account |
| Security and account-event records (no health content) | [[COUNSEL]] default 400 days | Kept until that period ends, linked only to a random account id |
| AI usage and cost records (no content) | default 400 days | De-linked from you; kept until that period ends |
| Safety-alert records (alert level and rule ids — no message text) | default 730 days | De-linked from you; kept until that period ends |
| Backups and platform logs | [[DEPLOY: Supabase backup / point-in-time-recovery window; hosting log retention]] | Expire on that schedule; not restored except for disaster recovery [[COUNSEL]] |
| Copies held by the AI provider | [[OWNER: per provider contract]] | Outside our control once sent; governed by the provider's terms |
| Data on your device | Until you sign out, delete the app or clear it [[OWNER: confirm sign-out behaviour]] | — |

## Part B — Internal procedure

### B1. Requests made in the app (preferred)
Export, correction, item deletion, Apple Health deletion, permission withdrawal and account deletion
are self-service and logged in the audit trail (`account.export`, `consent.update`,
`account.delete_requested`, `account.delete`). No manual action is needed.

### B2. Requests made outside the app ([[OWNER: privacy email / form]])
1. **Log** the request (date, channel, type, state of residence if given) in [[OWNER: request log
   location]] — without copying health content into it.
2. **Verify identity.** Ask the person to sign in and use the in-app tool, or confirm by replying from
   the account's email address **and** a sign-in. Never send data to an unverified address.
   [[COUNSEL: verification standard; authorised agents; requests about a minor by a parent — there is no
   parent access, and the response for that case must be decided.]]
3. **Respond** within [[COUNSEL: deadline — e.g. 45 days under several state laws, with one extension]].
4. **Third-party list.** The export doesn't include the list of recipients yet (Audit G10); answer
   from the AI disclosure until it does.
5. **Appeals.** Handled by [[OWNER: person]], answered within [[COUNSEL]]; tell the person how to contact
   their attorney general if the appeal is refused.

### B3. Age reviews and under-13 accounts
- Accounts in `review` or restricted as under 13 stay locked; the deletion deadline doesn't move.
- A person who says a date was mistyped contacts support. [[OWNER/COUNSEL: what evidence support may
  accept without collecting ID from a child; there is no support tool yet — an operator would change the
  age state directly, which must be logged.]]
- Deletion when due is automatic (maintenance sweep), recorded as `account.delete_requested` with
  reason `age`, then `account.delete`.

### B4. Retention jobs
`pruneOperationalRecords` and `finishPendingDeletions` run every 5 minutes in the worker (or API).
Monitor that they run; an outage delays deletion.
