-- Generated from services/api/migrations/0008_health_record_foundation.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Phase 2A: real accounts and the long-term health record.
--
-- Adds profile preferences, notification preferences and in-app
-- notifications, and gives every structured health fact its provenance
-- (source + source reference), event dates, confidence, explicit
-- confirmation and supersession. See docs/health-memory-architecture.md.
--
-- Nothing here expires health data: history is kept until the person
-- deletes it. A correction supersedes a row (kept, linked, excluded from
-- "current"); a change in health (a medication stopped) is recorded with an
-- end date and stays true for its period.

-- ── Accounts: email verification mirrored from Supabase Auth ──────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users (id, email, password_hash, auth_provider, email_verified_at)
    VALUES (NEW.id, lower(coalesce(NEW.email, NEW.id::text || '@users.invalid')), NULL, 'supabase', NEW.email_confirmed_at)
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (user_id, first_name, last_name, time_zone)
    VALUES (
      NEW.id,
      left(coalesce(NEW.raw_user_meta_data->>'first_name', ''), 80),
      left(coalesce(NEW.raw_user_meta_data->>'last_name', ''), 80),
      left(coalesce(nullif(NEW.raw_user_meta_data->>'time_zone', ''), 'UTC'), 64)
    )
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.handle_updated_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.users SET email = lower(NEW.email) WHERE id = NEW.id;
  END IF;
  IF NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at THEN
    UPDATE public.users SET email_verified_at = NEW.email_confirmed_at WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS healthmate_on_auth_user_updated ON auth.users;
CREATE TRIGGER healthmate_on_auth_user_updated AFTER UPDATE OF email, email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_updated_auth_user();
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_auth_user() FROM PUBLIC, anon, authenticated;

-- ── Profile: only what the app needs ──────────────────────────────────────
-- Age is derived from date_of_birth, never stored. No address, phone or IDs.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS goals text[] NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS unit_system text NOT NULL DEFAULT 'metric';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
ALTER TABLE profiles ADD CONSTRAINT profiles_goals_check CHECK (cardinality(goals) <= 10);
ALTER TABLE profiles ADD CONSTRAINT profiles_unit_system_check CHECK (unit_system IN ('metric', 'imperial'));
ALTER TABLE profiles ADD CONSTRAINT profiles_time_zone_length CHECK (char_length(time_zone) BETWEEN 1 AND 64);

-- ── Notification preferences & in-app notifications ───────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  medication boolean NOT NULL DEFAULT true,
  task boolean NOT NULL DEFAULT true,
  appointment boolean NOT NULL DEFAULT true,
  report boolean NOT NULL DEFAULT true,
  insight boolean NOT NULL DEFAULT true,
  account boolean NOT NULL DEFAULT true,
  -- Health details on the lock screen are off unless the person turns them on.
  show_details boolean NOT NULL DEFAULT false,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start time NOT NULL DEFAULT '22:00',
  quiet_end time NOT NULL DEFAULT '07:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Written by the server (report ready, reminders, account events).
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('medication', 'task', 'appointment', 'report', 'insight', 'account')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  -- In-app path only (e.g. /reports/<id>); never an external URL.
  link text CHECK (link IS NULL OR (link ~ '^/[A-Za-z0-9/_?=&.-]*$' AND char_length(link) <= 200)),
  ai_generated boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

-- ── Provenance, dates and supersession on structured facts ────────────────
-- source never includes 'ai_inferred': an AI inference can't be stored as history.
ALTER TABLE health_conditions
  ADD COLUMN IF NOT EXISTS source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  ADD COLUMN IF NOT EXISTS onset_on date,
  ADD COLUMN IF NOT EXISTS resolved_on date,
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES health_conditions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE health_conditions ADD CONSTRAINT health_conditions_dates_check CHECK (resolved_on IS NULL OR onset_on IS NULL OR resolved_on >= onset_on);
ALTER TABLE health_conditions ADD CONSTRAINT health_conditions_superseded_check CHECK ((superseded_by IS NULL) OR (superseded_at IS NOT NULL));
ALTER TABLE health_conditions ADD CONSTRAINT health_conditions_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 120);

ALTER TABLE allergies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  ADD COLUMN IF NOT EXISTS source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  ADD COLUMN IF NOT EXISTS noted_on date,
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES allergies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE allergies ADD CONSTRAINT allergies_superseded_check CHECK ((superseded_by IS NULL) OR (superseded_at IS NOT NULL));

-- Medication instructions stay verbatim (0001/0004). Stopping a medication is
-- history (stopped_on), not a correction.
ALTER TABLE medications
  ADD COLUMN IF NOT EXISTS source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  ADD COLUMN IF NOT EXISTS started_on date,
  ADD COLUMN IF NOT EXISTS stopped_on date,
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES medications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE medications ADD CONSTRAINT medications_dates_check CHECK (stopped_on IS NULL OR started_on IS NULL OR stopped_on >= started_on);
ALTER TABLE medications ADD CONSTRAINT medications_superseded_check CHECK ((superseded_by IS NULL) OR (superseded_at IS NOT NULL));

ALTER TABLE symptoms
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user_reported' CHECK (source IN ('user_reported', 'clinician_provided', 'document_extracted', 'healthkit')),
  ADD COLUMN IF NOT EXISTS source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  ADD COLUMN IF NOT EXISTS resolved_on date,
  ADD COLUMN IF NOT EXISTS confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1);
ALTER TABLE symptom_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user_reported' CHECK (source IN ('user_reported', 'healthkit')),
  ADD COLUMN IF NOT EXISTS source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200);

-- ── Treatment plans (a clinician's plan; its tasks/medications are plan_items) ─
CREATE TABLE IF NOT EXISTS treatment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  -- The clinician's or document's wording, verbatim; never generated.
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  care_provider_id uuid REFERENCES care_providers(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('user_reported', 'clinician_provided', 'document_extracted')),
  source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  started_on date,
  ended_on date,
  confidence real NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  confirmed_at timestamptz,
  superseded_by uuid REFERENCES treatment_plans(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
  CHECK ((superseded_by IS NULL) OR (superseded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS treatment_plans_user_idx ON treatment_plans(user_id, created_at DESC);
ALTER TABLE plan_items ADD COLUMN IF NOT EXISTS treatment_plan_id uuid REFERENCES treatment_plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS plan_items_treatment_plan_idx ON plan_items(treatment_plan_id) WHERE treatment_plan_id IS NOT NULL;

-- ── Health memory: dates, category, supersession history ──────────────────
ALTER TABLE health_memories
  ADD COLUMN IF NOT EXISTS category text CHECK (category IS NULL OR category IN ('condition', 'medication', 'allergy', 'symptom', 'measurement', 'procedure', 'lifestyle', 'family_history', 'other')),
  ADD COLUMN IF NOT EXISTS ended_on date,
  ADD COLUMN IF NOT EXISTS record_type text CHECK (record_type IS NULL OR record_type IN ('condition', 'allergy', 'medication', 'symptom', 'treatment_plan', 'document', 'image', 'measurement')),
  ADD COLUMN IF NOT EXISTS record_id uuid,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES health_memories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  -- The provenance a superseded fact had, so history keeps its origin.
  ADD COLUMN IF NOT EXISTS prior_status text CHECK (prior_status IS NULL OR prior_status IN ('user_reported', 'document_extracted', 'clinician_provided', 'healthkit', 'ai_inferred', 'user_confirmed'));
UPDATE health_memories SET superseded_at = updated_at WHERE status = 'superseded' AND superseded_at IS NULL;
ALTER TABLE health_memories ADD CONSTRAINT health_memories_superseded_check CHECK ((status = 'superseded') = (superseded_at IS NOT NULL));
ALTER TABLE health_memories ADD CONSTRAINT health_memories_dates_check CHECK (ended_on IS NULL OR occurred_on IS NULL OR ended_on >= occurred_on);
CREATE INDEX IF NOT EXISTS health_memories_current_idx ON health_memories(user_id, updated_at DESC) WHERE status <> 'superseded';

-- Confirmation needs the person; an AI inference is never relabelled as
-- another provenance; superseded history stays superseded.
CREATE OR REPLACE FUNCTION public.guard_memory_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'user_confirmed' AND (OLD.status IS DISTINCT FROM 'user_confirmed') AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'confirming a memory requires an explicit confirmation by the person';
  END IF;
  IF OLD.status = 'ai_inferred' AND NEW.status NOT IN ('ai_inferred', 'user_confirmed', 'superseded') THEN
    RAISE EXCEPTION 'an AI inference can only be confirmed by the person or superseded';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'superseded memories are kept as history; add a new fact instead';
  END IF;
  IF NEW.status = 'superseded' AND OLD.status <> 'superseded' THEN
    NEW.prior_status := OLD.status;
    NEW.superseded_at := coalesce(NEW.superseded_at, now());
  END IF;
  IF NEW.fact IS DISTINCT FROM OLD.fact THEN
    NEW.embedding := NULL; -- re-embedded by the embeddings job
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END $$;

-- ── Current-state views (RLS applies: security_invoker) ───────────────────
CREATE OR REPLACE VIEW current_medications WITH (security_invoker = true) AS
  SELECT id, user_id, name, instruction, source, source_ref, started_on, created_at, updated_at
  FROM medications
  WHERE active AND superseded_at IS NULL AND (stopped_on IS NULL OR stopped_on > current_date);
CREATE OR REPLACE VIEW current_conditions WITH (security_invoker = true) AS
  SELECT id, user_id, name, source, source_ref, onset_on, notes, created_at, updated_at
  FROM health_conditions WHERE status = 'active' AND superseded_at IS NULL;
CREATE OR REPLACE VIEW current_allergies WITH (security_invoker = true) AS
  SELECT id, user_id, substance, reaction, severity, source, source_ref, noted_on, created_at, updated_at
  FROM allergies WHERE status = 'active' AND superseded_at IS NULL;

-- ── Row Level Security for the new tables and views ───────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_preferences', 'notifications', 'treatment_plans'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;
REVOKE ALL ON public.current_medications, public.current_conditions, public.current_allergies FROM anon;
GRANT SELECT ON public.current_medications, public.current_conditions, public.current_allergies TO authenticated;

SELECT public.healthmate_owner_policies('notification_preferences', ARRAY['SELECT', 'INSERT', 'UPDATE']);
-- Notifications are written by the server; people read, mark read and dismiss their own.
SELECT public.healthmate_owner_policies('notifications', ARRAY['SELECT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('treatment_plans', ARRAY['SELECT', 'UPDATE', 'DELETE']);
DROP POLICY IF EXISTS own_insert ON public.treatment_plans;
CREATE POLICY own_insert ON public.treatment_plans FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND source IN ('user_reported', 'clinician_provided'));

-- People may edit the timeline entries they added themselves.
DROP POLICY IF EXISTS own_update ON public.timeline_events;
CREATE POLICY own_update ON public.timeline_events FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND source_type = 'user_entered')
  WITH CHECK (user_id = (SELECT auth.uid()) AND source_type = 'user_entered');
