# Phase 2C plan — long-term health memory and real AI chat

Phase 2A made the record longitudinal (provenance, dates, supersession); Phase 2B made daily
health data real. Phase 2C makes the **AI Health Assistant** use that record well: it retrieves
the few facts that matter for each question — with their source, date and whether they are still
current — instead of sending the whole history, and it tells the person what it was based on.

Rules: [`CLAUDE.md`](../CLAUDE.md). Memory model: [`health-memory-architecture.md`](health-memory-architecture.md).

## 1. What exists (inspection before any 2C change)

| Area | State before 2C |
|---|---|
| Model access | `AnthropicProvider` (server-side key only) → Claude Messages API with structured outputs (JSON schema), prompt caching of the stable system prompt, server-side refusal fallbacks. Default model `claude-opus-5`. `AiGateway` records token usage (no content). `FakeAiProvider` in tests, `DemoProvider` for the demo server, `UnavailableProvider` when no key. |
| Chat pipeline | Deterministic triage → emergency: fixed guidance, no model call → context (profile summary + `MemoryService.relevant`) → model → safety review → one rewrite → safe fallback. Last 20 messages of the conversation are sent. |
| Memory storage | `health_memories` with provenance, `occurred_on`/`ended_on`, category, confidence, confirmation, supersession history (`prior_status`), pgvector embedding (384-d) + full-text index. |
| Retrieval | Union of nearest neighbours (distance < 0.6), full-text matches and the 4 most recent reported/confirmed facts; superseded excluded. **No ranking, no budget**, no notion of current vs historical in the prompt beyond the date, AI inferences mixed in unlabelled by weight. |
| Structured record in context | `ProfileService.contextSummary`: current vs past conditions and medications with dates — **every** past item, however old. |
| Daily health data (2B) | Not used by chat at all. |
| User control | View, search, add, edit/confirm, supersede, delete one, export. No way to keep a fact but stop the AI using it; no bulk delete; no filter by current/historical/superseded. |
| Transparency | Answers are labelled "AI-generated · not a diagnosis" but don't say what they were based on (CLAUDE.md asks for both). |

## 2. Design

### 2.1 Memory lifecycle

Every memory has a **temporal status**, derived (never stored twice):

| Status | Meaning |
|---|---|
| `current` | Not superseded, and no end date (or the end date is in the future). |
| `historical` | Was true for a period that has ended (`ended_on` in the past). Kept, labelled as past. |
| `superseded` | Replaced by a correction. Kept for history and export, never used by the AI. |

New in 2C (migration `0010`):
- `ai_excluded` — the person keeps the fact but the AI Health Assistant never sees it.
- `last_used_at` — when a fact last informed an answer (shown for transparency).
- Categories are assigned deterministically from the fact's wording when not given
  (`medication`, `condition`, `allergy`, `symptom`, `measurement`, `lifestyle`, …).

API additions: list filters (`status=current|historical|superseded|all`, `category`, `q`),
`temporalStatus` + `aiExcluded` + `lastUsedAt` on every memory, `PATCH aiExcluded`,
`POST /v1/memories/:id/end` ("no longer true" → historical), `GET /v1/memories/:id/history`
(supersession chain), `DELETE /v1/memories` (all, with explicit confirmation). Export unchanged
(everything, including superseded).

### 2.2 Retrieval (what the AI sees)

`selectMemoriesForContext` (pure, unit-tested) ranks candidates from three retrievers — semantic
(pgvector cosine), full-text (Postgres `ts_rank`) and category keywords — plus a small set of
recent confirmed facts, then applies:

- **Relevance**: semantic similarity and text rank, normalised.
- **Provenance weight**: clinician / confirmed > reported > document / Apple Health > unconfirmed AI inference (included only when relevant, always labelled "unconfirmed").
- **Time**: current facts don't decay; historical facts decay with age (half-life ~2 years) so old history appears only when relevant.
- **Hard exclusions**: superseded, `ai_excluded`, other people's data (user-scoped SQL).
- **Budget**: at most 12 facts and ~2,400 characters; never the whole history.

The prompt lists **current** facts and **past** facts in separate sections, each with source and
date (`describeMemory`, from 2A).

Structured record: current conditions, allergies and medications are always included (they're
safety-relevant and short); **past** ones are limited to those mentioned in the question plus the
5 most recent.

Daily health data (2B): for metrics the question is about (keyword map: sleep, steps, heart
rate, weight, activity, energy/tiredness → sleep + activity + resting HR), a compact line per
metric: last-7-day average vs the person's previous 30 days — "within / above / below your usual
range" (never "normal"), with the date range and source. Nothing when no data or not relevant.

### 2.3 Real AI chat

- Default model `claude-opus-5-5` (configurable `AI_MODEL`), structured JSON output validated by
  zod, effort `medium`, stable system prompt cached, `fallbacks: "default"` on refusals.
- Context is data inside `<health_context>`; the system prompt says it is never instructions.
- Each answer carries `context` — what it was based on: counts and short labels of the memories
  used (ids for the app), whether the profile and which Apple Health metrics were used. Clients
  show "AI-generated · based on …" (existing label, extended). Used memories get `last_used_at`.
- Memory suggestions from the model are only facts the person stated; they are saved only when
  the person taps Remember (as `user_confirmed`), with a deterministic category.

### 2.4 Clients

No redesign. Additions: the "based on" text in the existing AI label (web + iOS); memory list shows
current / past / replaced status and a "Don't use in AI chat" control; Preview backends mirror
every new route and return a sample `context`.

## 3. Safety & privacy

- Superseded and `ai_excluded` facts never reach the model (tests).
- The whole history is never sent (budget test with hundreds of facts).
- AI inferences are labelled unconfirmed in the prompt and weighted down.
- "Usual range" wording only; no "normal/abnormal".
- Logs and `ai_usage` keep token counts only.
- Emergency triage still bypasses the model entirely.

## 4. Tests

API: lifecycle and filters, exclusion, end/history/delete-all, isolation, retrieval ranking and
budget (pure + DB), daily-health context wording, chat prompt contents (fake provider),
`context` on answers and `last_used_at`, provider request shape against a mocked Anthropic HTTP
endpoint (model, structured output, cache control, fallbacks, refusal handling). RLS for new
columns is covered by existing policies (tested). Web unit + e2e, Swift Core decoding, iOS build
and UI tests unchanged.

## 5. Out of scope (later)

Document extraction into memories, a review inbox for AI-inferred suggestions, streaming chat
responses, push notifications, OAuth.
