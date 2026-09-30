# Phase 2B plan — daily health data and Apple Health (HealthKit)

Phase 2A made accounts and the long-term record real. Phase 2B makes **daily health data** real:
a per-day record for each metric, fed by Apple Health on the iPhone (with the person's
permission) and by readings people enter themselves, kept in sync reliably — including a first
import of past history, offline use and failures part-way through.

Rules: [`CLAUDE.md`](../CLAUDE.md). Record design: [`health-memory-architecture.md`](health-memory-architecture.md).
Phase overview: [`phase2-plan.md`](phase2-plan.md) (2B there is renamed 2C: AI on the new memory model moves after this).

## 1. What exists (inspection before any 2B change)

| Area | State before 2B |
|---|---|
| iOS reading | `HealthKitService` reads steps, heart rate, resting heart rate, active energy, weight (statistics collection queries, one value per day — HealthKit de-duplicates iPhone + Apple Watch) and sleep (merged "asleep" intervals, attributed to the wake-up day). Read-only; never writes to Apple Health. |
| iOS permission | `requestAuthorization` for those 6 types; a local `appleHealthConnected` flag (HealthKit never reveals whether *read* access was granted). |
| iOS sync | Manual "Sync" button: uploads **completed days only** as `health_measurements` rows with `externalId = apple_health:<kind>:<day>` and `ON CONFLICT DO NOTHING`. |
| Server | `health_measurements` (raw readings), `healthkit_connections` (status, scopes, last sync), trends aggregate measurements per day in the person's time zone. |
| Web | Health pages read `health-data/trends`, `health-data/latest`, `healthkit/connection`; people can add readings. |
| Preview | iOS and web Preview backends serve sample Apple Health series. |

**Gaps**

1. **A synced day can never change.** `DO NOTHING` keeps the first value, so steps synced at
   noon, or before the Watch uploaded, stay wrong forever. Today is never synced at all.
2. **No history import.** Only the dashboard's loaded period (7–90 days × 2) is ever uploaded.
3. **Sync is manual** and not resumable; a failure part-way loses progress; offline just fails.
4. **No sync status on the server** (what was imported, when, what failed) for web or support.
5. **Daily data is mixed into raw measurements**, so the server can't tell a daily total from a
   single reading; summing samples server-side would double-count iPhone + Watch.
6. **Permission state** is only a local flag; there's no "review access" path when types are
   added later.

## 2. Design

### 2.1 Daily health records (server)

New table **`daily_health_records`** — one row per person × day × metric × source:

| Column | Meaning |
|---|---|
| `day` | The person's local calendar day (YYYY-MM-DD) the value belongs to (sleep: the wake-up day). |
| `kind`, `unit` | Same canonical kinds/units as `health_measurements`. |
| `value` | Daily total (steps, active energy, sleep, water) or daily average (heart rate, resting HR, weight, BP, glucose). |
| `min_value`, `max_value`, `sample_count` | When the source knows them. |
| `source` | `apple_health` (computed on the iPhone by HealthKit, already de-duplicated across devices) or `user_entered` (derived on the server from readings people add). |
| `is_complete` | `false` while the day is still in progress (today); becomes `true` once the day is over. |
| `time_zone` | The zone the day was computed in (travel is visible, not silently merged). |
| `source_device`, `sync_run_id` | Provenance: which device and which sync wrote it. |
| `computed_at`, `created_at`, `updated_at` | When the value was computed on the device / stored / last changed. |

- **Upserts, not inserts.** A day is re-sent until it's complete and settled; a newer
  `computed_at` replaces the value (an older one never overwrites a newer one — out-of-order
  batches are safe). Unchanged values don't bump `updated_at`.
- **`user_entered`** daily rows are recomputed by the server whenever a person adds or deletes a
  reading, so trends read one table.
- **Which source wins for a day:** Apple Health's daily value when present (it's the complete,
  de-duplicated one); otherwise the person's own readings. Both rows are kept.
- `health_measurements` stays for individual readings (manual entries). Existing Apple Health
  rows written by the old sync are copied into `daily_health_records` by the migration and left in
  place; the new iOS app stops writing them.

### 2.2 Sync bookkeeping (server, no health content)

- `healthkit_connections` gains `device_id` (random per install), `history_status`
  (`not_started` / `importing` / `complete` / `failed`), `history_from` (oldest day imported),
  `history_days_requested`, `last_error_code`, `last_error_at`.
- New **`health_sync_runs`**: one row per sync (kind `initial_import` / `incremental` / `manual`,
  status, days sent, records upserted, oldest/newest day, error code, times). Codes only.

### 2.3 API

| Route | Purpose |
|---|---|
| `PUT /v1/health-data/daily` | Upload up to 500 daily records (Apple Health). Requires `health_data_sync` consent. Bounds-checked, idempotent, newest `computed_at` wins. Returns `{ upserted, unchanged, ignoredOlder }`. |
| `GET /v1/health-data/daily?from&to&kinds` | Daily records (≤ 400 days per call), preferred source per day plus which sources exist. |
| `POST /v1/healthkit/sync-runs` / `PATCH /v1/healthkit/sync-runs/:id` | Start / finish a run (status, counts, error code). Updates the connection's history status and last sync. |
| `GET /v1/healthkit/connection` | Now also returns history import status, oldest imported day, last error. |
| `GET /v1/health-data/trends`, `latest` | Same contract; now read daily records (Apple Health preferred), so web and iOS agree. |
| `DELETE /v1/healthkit/connection` | Also removes Apple Health daily records and sync runs' device link. |

### 2.4 iOS

**Core (`HealthMateCore`, pure, unit-tested on Linux):**

- `DailyHealthRecord` / `DailyRecordUpload` models.
- `HealthSyncPlanner`: from the saved sync state, today and the chosen history length, decides
  which days to read: the whole history window on first import (newest first, in 30-day chunks
  so progress shows quickly and a failure resumes where it stopped), then **incremental** = days
  since the last complete sync **plus the last 3 days again** (late Apple Watch / sleep data) and
  today as incomplete.
- `HealthSyncState` (Codable, persisted in `UserDefaults`, no health values): device id, last
  successful sync, oldest imported day, import cursor, per-run status.
- `HealthSyncEngine` (actor): reads via a `DailyHealthSource` protocol, uploads via a
  `DailyHealthUploader` protocol in batches of ≤ 500, saves progress after every batch,
  classifies failures:

| Failure | Behaviour | Shown as |
|---|---|---|
| Offline / timeout | Stop, keep progress, retry on next trigger | "You're offline — we'll sync when you're back online. Your data is safe on this iPhone." |
| 401 | Stop; session handling signs out | (sign-in screen) |
| 403 consent | Stop, don't retry until consent is given | "Turn on Apple Health sync in Privacy to save it to your account." |
| 429 / 5xx | Stop, keep progress, back off | "HealthMate couldn't sync right now. We'll try again shortly." |
| 400 (a bad batch) | Skip that batch, report code, continue | "Some days couldn't be synced." |
| HealthKit read error | Stop, keep progress | "Apple Health didn't respond. Try again in a moment." |

- Throttled: automatic sync at most every 15 minutes; manual "Sync now" always runs.

**App:**

- `HealthKitService` adds `readDailyRecords(_:from:to:)` for long ranges (statistics collection
  queries return min/max/count too) and `authorizationRequestStatus` (`shouldRequest` → "Review
  Apple Health access").
- Triggers: after connecting, when the app becomes active, on HealthKit **background delivery**
  (`HKObserverQuery` + `enableBackgroundDelivery(.hourly)`, entitlement
  `com.apple.developer.healthkit.background-delivery`), and the existing "Sync now" button.
- History length choice on connect (default 1 year; 3 months / 1 year / 2 years) — stored per device.
- The dashboard's existing sync card shows import progress ("Importing your history… 4 of 12
  months"), last sync time, and the error messages above. No redesign; Preview mode unchanged.
- Only when signed in **and** the `health_data_sync` consent is on does anything leave the
  iPhone; otherwise Apple Health is read and shown on-device only (as today).

### 2.5 Web

No new screens. Trends/latest/connection keep their contracts; the Apple Health status card shows
history import status when the server reports it. Preview router gains the daily routes.

## 3. Safety, privacy, security

- Read-only HealthKit; nothing is written to Apple Health.
- Plausibility bounds on every value (not clinical thresholds); out-of-range days rejected.
- Metric copy stays "in your usual range" — no "normal/abnormal".
- RLS: `daily_health_records` and `health_sync_runs` owner-read-only (server writes); anon none.
- Logs and sync runs hold counts and codes only, never values.
- Disconnect offers removing everything synced from Apple Health (daily records included).
- Export includes daily records and sync runs.

## 4. Tests

- API: daily upsert semantics (newer wins, older ignored, unchanged not bumped, incomplete →
  complete), bounds, consent, isolation, trends/latest from daily records, source preference,
  user-entered recomputation, sync runs, disconnect removal, export, migration backfill.
- RLS: new tables owner-read-only; views/policies.
- Swift Core: planner (first import chunks, resume after failure, incremental overlap, today
  incomplete, time zone day boundaries), engine (batching, progress saved per batch, offline keeps
  cursor, consent stops, bad batch skipped), models decode/encode.
- Existing web e2e + accessibility and iOS UI tests unchanged (Preview mode).

## 5. Manual testing (needs a real iPhone with Apple Health data)

HealthKit has no data in CI's simulator; the import, background delivery and permission sheets
are checked by hand — see the Phase 2B report for the checklist.
