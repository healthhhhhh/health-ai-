# Health memory architecture

How HealthMate keeps a person's health history for years, knows where every fact came from and
when it was true, and keeps AI inferences apart from confirmed history. Rules:
[`CLAUDE.md`](../CLAUDE.md) (`ai_inferred` ≠ `user_confirmed`; never invent history).

## 1. Two layers

| Layer | Tables | What it is |
|---|---|---|
| **Structured record** | `health_conditions`, `allergies`, `medications`, `symptoms` + `symptom_events`, `health_measurements`, `medical_documents` + `document_extractions`, `health_images`, `treatment_plans` + `plan_items`, `appointments`, `timeline_events` | Typed facts with their own columns and dates. The source of truth for "what is current". |
| **Memory** | `health_memories` | Short free-text facts ("Evening headaches, usually after screen time") with provenance, dates and an embedding (pgvector, 384-d). Used to find relevant context for the AI Health Assistant. May reference a structured row (`record_type` + `record_id`). |

Conversations (`conversations`, `messages`) are the raw log; nothing in them becomes a fact unless
the person saves or confirms it.

## 2. Every fact carries

| Column | Meaning |
|---|---|
| `user_id` | Owner. RLS: `user_id = auth.uid()` on every table. |
| `source` / `status` | Provenance (below). |
| `source_ref` / `source_id` | Where exactly: document id, message id, HealthKit sample id, clinician/letter reference. |
| `created_at` | When HealthMate recorded it. |
| event date | When it happened / was true: `onset_on`, `resolved_on`, `started_on`, `stopped_on`, `noted_on`, `occurred_on`, `ended_on`, `occurred_at`, `recorded_at`. |
| status | Clinical state of the fact: `active`/`resolved` (conditions, symptoms), `active`/`inactive` (allergies), `active` + `stopped_on` (medications). |
| `confidence` | 0–1. 1 for what the person or a clinician stated; lower for extractions. Never used as proof. |
| `confirmed_at` | Set only by an explicit confirmation by the person. |
| `superseded_by`, `superseded_at` | Replaced by a correction (see §4). Superseded rows are kept, excluded from "current". |

## 3. Provenance

| Value | Set by | Shown to the AI as |
|---|---|---|
| `user_reported` | The person typed it / chose it | "User reported" |
| `user_confirmed` | The person confirmed or edited a suggestion (sets `confirmed_at`) | "User confirmed" |
| `document_extracted` | Extraction from an uploaded document (untrusted input; 2B) | "From an uploaded document" |
| `clinician_provided` | The person entered it as their clinician's words (e.g. medication instructions, verbatim) | "Clinician provided" |
| `healthkit` | Apple Health sync | "From Apple Health" |
| `ai_inferred` | Server-side AI pipeline only | "Unconfirmed AI inference — not verified; do not treat as fact" |
| `superseded` | A correction replaced it (`prior_status` keeps the original provenance) | never sent |

**Guarantees (enforced in the database, tested in `test/rls.test.ts` and `test/memory-history.test.ts`):**

1. Structured fact tables have `source` check constraints that do not include `ai_inferred` —
   an inference can't be stored as a condition, allergy, medication, symptom or treatment plan.
2. `health_memories`: a user session can only insert `user_reported`/`user_confirmed` (RLS).
3. Promotion to `user_confirmed` requires a new `confirmed_at` (trigger
   `guard_memory_confirmation`).
4. An `ai_inferred` memory can only become `user_confirmed` (explicitly) or `superseded` — never
   silently `user_reported`, `clinician_provided`, etc. (same trigger, added in 0008).
5. A superseded memory stays superseded (history is append-only); its original provenance is
   kept in `prior_status`.
6. Embedding similarity only *selects* context. Each fact is sent with its provenance and date.

## 4. Time: corrections vs. changes

- **Correction** ("I typed the wrong name"): `POST /v1/memories/:id/supersede` (or the
  structured equivalent) creates the new fact and marks the old one `superseded`, linked by
  `superseded_by`. The old row is excluded from context and from "current" views.
- **Change in health** ("I stopped Medication A; I now take Medication B"): nothing is
  superseded. A gets `active = false, stopped_on = <date>`; B is a new row with
  `started_on`. Both remain true for their periods.

Views (`security_invoker`, so RLS applies): `current_medications` (active, not stopped, not
superseded), `current_conditions` (active, not superseded), `current_allergies`.

The AI context separates the two (`ProfileService.contextSummary`):

```
Current medications (instructions verbatim): Medication B: "…" [user_reported, started 2026-08-01]
Past medications (not current): Medication A [stopped 2026-07-28]
```

## 5. Retrieval for the AI Health Assistant

`MemoryService.relevant(userId, text)` = user-scoped nearest neighbours (cosine distance < 0.6)
∪ full-text matches ∪ the four most recent reported/confirmed facts; superseded rows excluded.
Each memory is rendered by `describeMemory(memory, today)`:

```
Previous relevant history (each with its source and date; unconfirmed items are not facts):
- User reported: Evening headaches (about 3 months ago, 2026-06-30)
- Unconfirmed AI inference — not verified; do not treat as fact: Possible poor sleep (2 days ago, 2026-09-28)
```

The date used is the event date (`occurred_on`) when known, otherwise when it was recorded. An
`ended_on` date adds "no longer current since …". Everything inside `<health_context>` is data,
never instructions — document text in particular can't override safety rules (the system prompt
says so, and document analysis runs injection detection).

## 6. Retention, correction, export, deletion

| Data | Default | Configurable by |
|---|---|---|
| Health record + memories + documents/images + conversations | Kept until the person deletes it. **No automatic expiry.** | The person (per item, or delete account) |
| `audit_logs` (no health content) | 400 days | `AUDIT_LOG_RETENTION_DAYS` |
| `ai_usage` (token counts only) | 400 days | `AI_USAGE_RETENTION_DAYS` |
| `safety_events` (levels and rule ids only) | 730 days | `SAFETY_EVENT_RETENTION_DAYS` |

Pruning runs in the worker's housekeeping (`startMaintenance`). `0` disables pruning for that
table.

The person can **view** everything (profile, memory list, timeline, reports), **correct**
(`PATCH` conditions, allergies, medications dates/status, memories, timeline entries they added),
**delete** any item, **export** everything (`GET /v1/me/export`, format `healthmate-export-v2`,
every table including superseded history) and **delete the account** (Storage files, then the
Auth identity; every row cascades; idempotent with a sweeper).

## 7. Future (2B+)

- Document extraction writes `document_extracted` rows with `source_ref` = document id and
  `confidence` < 1, shown for confirmation — never auto-confirmed.
- Retrieval filters on `category` and dates ("since the last appointment").
- A confirmation inbox for `ai_inferred` / `document_extracted` suggestions.
