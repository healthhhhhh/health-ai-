-- Generated from services/api/migrations/0009_daily_health_records.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Phase 2B: daily health records and Apple Health sync bookkeeping.
-- See docs/phase2b-plan.md.
--
-- One row per person × local day × metric × source. Apple Health values are
-- computed on the iPhone by HealthKit (already de-duplicated across iPhone and
-- Apple Watch) and upserted: a newer computation replaces an older one, so a
-- day synced before the Watch caught up is corrected later. Values people
-- enter themselves are kept as readings (health_measurements) and summarised
-- here by the server. Health data never expires automatically.

CREATE TABLE IF NOT EXISTS daily_health_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'heart_rate', 'resting_heart_rate', 'steps', 'sleep', 'active_energy', 'weight',
    'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose', 'water')),
  unit text NOT NULL,
  value double precision NOT NULL,
  min_value double precision,
  max_value double precision,
  sample_count integer CHECK (sample_count IS NULL OR sample_count >= 0),
  source text NOT NULL CHECK (source IN ('apple_health', 'user_entered')),
  -- false while the day is still in progress (e.g. today's steps so far).
  is_complete boolean NOT NULL DEFAULT true,
  -- The zone the day was computed in, so travel stays visible.
  time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 64),
  source_device text CHECK (source_device IS NULL OR char_length(source_device) <= 120),
  sync_run_id uuid,
  -- When the value was computed (on the iPhone for Apple Health). Newer wins.
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, kind, source),
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
CREATE INDEX IF NOT EXISTS daily_health_records_user_kind_idx ON daily_health_records(user_id, kind, day DESC);

-- Sync bookkeeping: counts and error codes only, never health values.
CREATE TABLE IF NOT EXISTS health_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  kind text NOT NULL CHECK (kind IN ('initial_import', 'incremental', 'manual')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  days_sent integer NOT NULL DEFAULT 0 CHECK (days_sent >= 0),
  records_upserted integer NOT NULL DEFAULT 0 CHECK (records_upserted >= 0),
  oldest_day date,
  newest_day date,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,40}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (oldest_day IS NULL OR newest_day IS NULL OR oldest_day <= newest_day)
);
CREATE INDEX IF NOT EXISTS health_sync_runs_user_idx ON health_sync_runs(user_id, started_at DESC);
ALTER TABLE daily_health_records ADD CONSTRAINT daily_health_records_sync_run_fk FOREIGN KEY (sync_run_id) REFERENCES health_sync_runs(id) ON DELETE SET NULL;

ALTER TABLE healthkit_connections
  ADD COLUMN IF NOT EXISTS device_id text CHECK (device_id IS NULL OR char_length(device_id) <= 64),
  ADD COLUMN IF NOT EXISTS history_status text NOT NULL DEFAULT 'not_started' CHECK (history_status IN ('not_started', 'importing', 'complete', 'failed')),
  ADD COLUMN IF NOT EXISTS history_from date,
  ADD COLUMN IF NOT EXISTS history_days_requested integer CHECK (history_days_requested IS NULL OR history_days_requested BETWEEN 1 AND 3660),
  ADD COLUMN IF NOT EXISTS last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z_]{1,40}$'),
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

-- ── Copy existing data ────────────────────────────────────────────────────
-- Days the previous iOS sync stored as measurements (external id
-- "apple_health:<kind>:<YYYY-MM-DD>") become Apple Health daily records.
INSERT INTO daily_health_records (user_id, day, kind, unit, value, source, is_complete, time_zone, source_device, computed_at, created_at)
  SELECT m.user_id, split_part(m.external_id, ':', 3)::date, m.kind, m.unit, m.value, 'apple_health', true,
         coalesce(p.time_zone, 'UTC'), m.source_device, m.created_at, m.created_at
  FROM health_measurements m LEFT JOIN profiles p ON p.user_id = m.user_id
  WHERE m.source = 'apple_health' AND m.external_id ~ '^apple_health:[a-z_]+:\d{4}-\d{2}-\d{2}$'
  ON CONFLICT (user_id, day, kind, source) DO NOTHING;

-- Readings people entered, summarised per local day (totals for cumulative kinds, averages for the rest).
INSERT INTO daily_health_records (user_id, day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, computed_at)
  SELECT m.user_id, (m.recorded_at AT TIME ZONE coalesce(p.time_zone, 'UTC'))::date, m.kind, min(m.unit),
         CASE WHEN m.kind IN ('steps', 'sleep', 'active_energy', 'water') THEN sum(m.value) ELSE avg(m.value) END,
         min(m.value), max(m.value), count(*)::int, 'user_entered', true, coalesce(min(p.time_zone), 'UTC'), max(m.created_at)
  FROM health_measurements m LEFT JOIN profiles p ON p.user_id = m.user_id
  WHERE m.source = 'user_entered'
  GROUP BY m.user_id, 2, m.kind
  ON CONFLICT (user_id, day, kind, source) DO NOTHING;

-- ── Views ─────────────────────────────────────────────────────────────────
-- One value per person × day × metric: Apple Health's de-duplicated value
-- when present, otherwise the person's own readings.
CREATE OR REPLACE VIEW daily_health_summary WITH (security_invoker = true) AS
  SELECT DISTINCT ON (user_id, day, kind)
         user_id, day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, updated_at
  FROM daily_health_records
  ORDER BY user_id, day, kind, (source = 'apple_health') DESC;

-- ── RLS: people read their own; the API writes (validation, consent) ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_health_records', 'health_sync_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;
REVOKE ALL ON public.daily_health_summary FROM anon;
GRANT SELECT ON public.daily_health_summary TO authenticated;

SELECT public.healthmate_owner_policies('daily_health_records', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('health_sync_runs', ARRAY['SELECT']);
