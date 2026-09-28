-- Generated from services/api/migrations/0004_complete_schema.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Complete HealthMate schema for Supabase PostgreSQL (and local PGlite).
--
-- Evolves 0001–0003 without dropping data: documents are copied into
-- medical_documents / health_images (the old table is kept as
-- documents_legacy), plans are normalised into plan_items /
-- task_completions / reminders, and health memories gain provenance
-- constraints and a pgvector embedding column.
--
-- Deletion policy: health data is hard-deleted when the person deletes it
-- (and on account deletion). Soft delete (deleted_at) is used only for care
-- providers and appointments, and users.deletion_requested_at makes account
-- deletion idempotent.

-- ── Extensions ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions';
  ELSE
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  END IF;
END $$;

-- ── Helpers ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ── Users & profiles ──────────────────────────────────────────────────────
-- users.id equals auth.users.id when Supabase Auth is used (see 0005).
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check CHECK (auth_provider IN ('local', 'supabase'));
ALTER TABLE users ADD CONSTRAINT users_local_password_check CHECK (auth_provider <> 'local' OR password_hash IS NOT NULL);

ALTER TABLE profiles ADD CONSTRAINT profiles_sex_check CHECK (sex IS NULL OR sex IN ('female', 'male', 'intersex', 'prefer_not_to_say'));
ALTER TABLE profiles ADD CONSTRAINT profiles_height_check CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 272);
ALTER TABLE profiles ADD CONSTRAINT profiles_first_name_length CHECK (char_length(first_name) <= 80);

-- ── Conditions, allergies, medications ────────────────────────────────────
ALTER TABLE health_conditions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_conditions ADD CONSTRAINT health_conditions_status_check CHECK (status IN ('active', 'resolved'));
ALTER TABLE health_conditions ADD CONSTRAINT health_conditions_source_check CHECK (source IN ('user_reported', 'clinician_provided', 'document_extracted'));

ALTER TABLE allergies ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE allergies ADD CONSTRAINT allergies_severity_check CHECK (severity IS NULL OR severity IN ('mild', 'moderate', 'severe'));
ALTER TABLE allergies ADD CONSTRAINT allergies_source_check CHECK (source IN ('user_reported', 'clinician_provided', 'document_extracted'));

-- The instruction is the clinician's or label's wording, stored verbatim.
ALTER TABLE medications ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE medications ADD CONSTRAINT medications_source_check CHECK (source IN ('user_reported', 'clinician_provided'));
ALTER TABLE medications ADD CONSTRAINT medications_instruction_present CHECK (char_length(btrim(instruction)) > 0);

-- ── Symptoms ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS symptoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  body_area text CHECK (body_area IS NULL OR char_length(body_area) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  first_noted_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS symptoms_user_name_idx ON symptoms(user_id, lower(name));

CREATE TABLE IF NOT EXISTS symptom_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symptom_id uuid NOT NULL REFERENCES symptoms(id) ON DELETE CASCADE,
  severity smallint CHECK (severity IS NULL OR severity BETWEEN 0 AND 10),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  -- Deterministic triage of what the person wrote (packages/safety), never AI.
  triage_level text CHECK (triage_level IS NULL OR triage_level IN ('informational', 'routine', 'urgent', 'emergency')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS symptom_events_user_idx ON symptom_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS symptom_events_symptom_idx ON symptom_events(symptom_id, occurred_at DESC);

-- ── Measurements & HealthKit ──────────────────────────────────────────────
ALTER TABLE health_measurements ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE health_measurements ADD CONSTRAINT health_measurements_source_check CHECK (source IN ('apple_health', 'user_entered'));
ALTER TABLE health_measurements ADD CONSTRAINT health_measurements_kind_check CHECK (kind IN (
  'heart_rate', 'resting_heart_rate', 'steps', 'sleep', 'active_energy', 'weight',
  'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose', 'water'));

CREATE TABLE IF NOT EXISTS healthkit_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  device_name text CHECK (device_name IS NULL OR char_length(device_name) <= 120),
  scopes text[] NOT NULL DEFAULT '{}',
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Apple Health samples are health_measurements with source 'apple_health';
-- this view gives them their own name without duplicating rows.
CREATE OR REPLACE VIEW healthkit_measurements WITH (security_invoker = true) AS
  SELECT id, user_id, kind, value, unit, recorded_at, source_device, external_id, created_at, updated_at
  FROM health_measurements WHERE source = 'apple_health';

-- ── Conversations & messages ──────────────────────────────────────────────
ALTER TABLE conversations ADD CONSTRAINT conversations_title_length CHECK (char_length(title) <= 200);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE messages ADD CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant'));
ALTER TABLE messages ADD CONSTRAINT messages_triage_check CHECK (triage_level IS NULL OR triage_level IN ('informational', 'routine', 'urgent', 'emergency'));

-- ── Medical documents & health images (files live in Storage) ─────────────
CREATE TABLE IF NOT EXISTS medical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  storage_bucket text NOT NULL DEFAULT 'medical-reports',
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_upload' CHECK (status IN ('awaiting_upload', 'processing', 'ready', 'failed')),
  failure_reason text,
  document_type text CHECK (document_type IS NULL OR document_type IN ('lab_results', 'imaging_report', 'prescription', 'discharge_summary', 'clinic_letter', 'other')),
  page_count integer CHECK (page_count IS NULL OR page_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (storage_bucket, storage_path),
  -- Objects are always stored under the owner's folder.
  CHECK (split_part(storage_path, '/', 1) = user_id::text)
);
CREATE INDEX IF NOT EXISTS medical_documents_user_idx ON medical_documents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS medical_documents_processing_idx ON medical_documents(status, updated_at) WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS document_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  model text NOT NULL,
  readable boolean NOT NULL,
  summary text NOT NULL,
  suggested_questions jsonb NOT NULL DEFAULT '[]',
  injection_detected boolean NOT NULL DEFAULT false,
  -- The full AI-generated result as shown to the person (always labelled AI-generated).
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_analysis_document_idx ON document_analysis(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  analysis_id uuid NOT NULL REFERENCES document_analysis(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL,
  -- Values are copied exactly as printed on the report.
  value text NOT NULL,
  unit text,
  reference_range text,
  flag text NOT NULL CHECK (flag IN ('within_range', 'high', 'low', 'abnormal', 'not_stated')),
  page integer CHECK (page IS NULL OR page > 0),
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, position)
);
CREATE INDEX IF NOT EXISTS document_extractions_user_idx ON document_extractions(user_id, name);

CREATE TABLE IF NOT EXISTS document_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);

CREATE TABLE IF NOT EXISTS health_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'other' CHECK (purpose IN ('skin', 'wound', 'swelling', 'other')),
  -- The person's optional note, passed to the analysis as untrusted input.
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  storage_bucket text NOT NULL DEFAULT 'health-images',
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_upload' CHECK (status IN ('awaiting_upload', 'processing', 'ready', 'failed')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (storage_bucket, storage_path),
  CHECK (split_part(storage_path, '/', 1) = user_id::text)
);
CREATE INDEX IF NOT EXISTS health_images_user_idx ON health_images(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS health_images_processing_idx ON health_images(status, updated_at) WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS image_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES health_images(id) ON DELETE CASCADE,
  model text NOT NULL,
  quality text NOT NULL CHECK (quality IN ('good', 'poor')),
  supported boolean NOT NULL,
  care_urgency text NOT NULL CHECK (care_urgency IN ('self_care', 'routine', 'soon', 'urgent', 'emergency')),
  injection_detected boolean NOT NULL DEFAULT false,
  note_triage_level text CHECK (note_triage_level IS NULL OR note_triage_level IN ('informational', 'routine', 'urgent', 'emergency')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_analysis_image_idx ON image_analysis(image_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  document_id uuid REFERENCES medical_documents(id) ON DELETE CASCADE,
  image_id uuid REFERENCES health_images(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((document_id IS NULL) <> (image_id IS NULL))
);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments(message_id);

-- Copy existing documents (0001) into the new tables; keep the old table.
INSERT INTO medical_documents (id, user_id, filename, content_type, byte_size, storage_bucket, storage_path, status, failure_reason, document_type, created_at, processed_at)
  SELECT id, user_id, filename, content_type, byte_size, 'medical-reports', storage_key, status, failure_reason,
         CASE WHEN result->>'documentType' IN ('lab_results', 'imaging_report', 'prescription', 'discharge_summary', 'clinic_letter', 'other') THEN result->>'documentType' END,
         created_at, processed_at
  FROM documents WHERE kind = 'report'
  ON CONFLICT DO NOTHING;
INSERT INTO document_analysis (user_id, document_id, model, readable, summary, suggested_questions, injection_detected, result, created_at)
  SELECT user_id, id, coalesce(model, result->>'model', 'unknown'), coalesce((result->>'readable')::boolean, false), coalesce(result->>'summary', ''),
         coalesce(result->'suggestedQuestions', '[]'), coalesce((result->>'injectionDetected')::boolean, false), result, coalesce(processed_at, created_at)
  FROM documents WHERE kind = 'report' AND result IS NOT NULL;
INSERT INTO health_images (id, user_id, purpose, filename, content_type, byte_size, storage_bucket, storage_path, status, failure_reason, created_at, processed_at)
  SELECT id, user_id, coalesce(purpose, 'other'), filename, content_type, byte_size, 'health-images', storage_key, status, failure_reason, created_at, processed_at
  FROM documents WHERE kind = 'image' AND content_type IN ('image/jpeg', 'image/png')
  ON CONFLICT DO NOTHING;
INSERT INTO image_analysis (user_id, image_id, model, quality, supported, care_urgency, injection_detected, note_triage_level, result, created_at)
  SELECT user_id, id, coalesce(model, result->>'model', 'unknown'), coalesce(result->>'quality', 'poor'), coalesce((result->>'supported')::boolean, false),
         coalesce(result->>'careUrgency', 'routine'), coalesce((result->>'injectionDetected')::boolean, false), result->>'noteTriageLevel', result, coalesce(processed_at, created_at)
  FROM documents WHERE kind = 'image' AND result IS NOT NULL AND content_type IN ('image/jpeg', 'image/png');
ALTER TABLE documents RENAME TO documents_legacy;

-- ── Health memory (provenance + pgvector) ─────────────────────────────────
-- status is the provenance of the fact. AI inferences stay 'ai_inferred'
-- until the person explicitly confirms them (confirmed_at is then set);
-- vector similarity is used only to find related facts, never as proof.
UPDATE health_memories SET status = 'healthkit' WHERE status = 'wearable';
ALTER TABLE health_memories ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
UPDATE health_memories SET confirmed_at = coalesce(updated_at, created_at) WHERE status = 'user_confirmed' AND confirmed_at IS NULL;
ALTER TABLE health_memories ADD CONSTRAINT health_memories_status_check CHECK (status IN (
  'user_reported', 'document_extracted', 'clinician_provided', 'healthkit', 'ai_inferred', 'user_confirmed', 'superseded'));
ALTER TABLE health_memories ADD CONSTRAINT health_memories_confirmation_check CHECK (status <> 'user_confirmed' OR confirmed_at IS NOT NULL);
ALTER TABLE health_memories ADD CONSTRAINT health_memories_confidence_check CHECK (confidence BETWEEN 0 AND 1);
ALTER TABLE health_memories ADD CONSTRAINT health_memories_fact_length CHECK (char_length(btrim(fact)) BETWEEN 1 AND 500);
-- gte-small (384 dimensions); see src/modules/memory/embeddings.ts.
ALTER TABLE health_memories ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE health_memories ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE health_memories ADD COLUMN IF NOT EXISTS embedded_at timestamptz;
CREATE INDEX IF NOT EXISTS health_memories_embedding_idx ON health_memories USING hnsw (embedding vector_cosine_ops);

-- Block an AI inference from being promoted without an explicit confirmation time.
CREATE OR REPLACE FUNCTION public.guard_memory_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'user_confirmed' AND (OLD.status IS DISTINCT FROM 'user_confirmed') AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN
    RAISE EXCEPTION 'confirming a memory requires an explicit confirmation by the person';
  END IF;
  IF NEW.fact IS DISTINCT FROM OLD.fact THEN
    NEW.embedding := NULL; -- re-embedded by the embeddings job
    NEW.embedded_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS health_memories_guard ON health_memories;
CREATE TRIGGER health_memories_guard BEFORE UPDATE ON health_memories FOR EACH ROW EXECUTE FUNCTION public.guard_memory_confirmation();

-- ── Plans, plan items, tasks, completions, reminders ──────────────────────
ALTER TABLE plans ALTER COLUMN document DROP NOT NULL;

CREATE TABLE IF NOT EXISTS plan_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  kind text NOT NULL CHECK (kind IN ('task', 'medication', 'habit')),
  time_of_day time NOT NULL,
  repeat_type text NOT NULL CHECK (repeat_type IN ('daily', 'weekdays', 'once')),
  repeat_days smallint[] CHECK (repeat_days IS NULL OR (repeat_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND cardinality(repeat_days) BETWEEN 1 AND 7)),
  repeat_day date,
  reminder_enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('user_reported', 'clinician_provided')),
  -- Medication instructions: verbatim from the clinician or label, never generated.
  instruction text CHECK (instruction IS NULL OR char_length(instruction) <= 1000),
  start_day date NOT NULL,
  end_day date,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'medication' OR (instruction IS NOT NULL AND char_length(btrim(instruction)) > 0)),
  CHECK ((repeat_type = 'weekdays') = (repeat_days IS NOT NULL)),
  CHECK ((repeat_type = 'once') = (repeat_day IS NOT NULL)),
  CHECK (end_day IS NULL OR end_day >= start_day)
);
CREATE INDEX IF NOT EXISTS plan_items_user_idx ON plan_items(user_id, position);

CREATE OR REPLACE VIEW tasks WITH (security_invoker = true) AS
  SELECT id, user_id, title, notes, time_of_day, repeat_type, repeat_days, repeat_day, reminder_enabled, source, start_day, end_day, created_at, updated_at
  FROM plan_items WHERE kind = 'task';

CREATE TABLE IF NOT EXISTS task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_item_id uuid NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  day date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_item_id, day)
);
CREATE INDEX IF NOT EXISTS task_completions_user_idx ON task_completions(user_id, day);

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_item_id uuid NOT NULL UNIQUE REFERENCES plan_items(id) ON DELETE CASCADE,
  time_of_day time NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- 'device': scheduled on the iPhone (today). 'push': server-sent (future).
  channel text NOT NULL DEFAULT 'device' CHECK (channel IN ('device', 'push')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_user_idx ON reminders(user_id);

-- Normalise plan documents written by 0003.
INSERT INTO plan_items (id, user_id, title, notes, kind, time_of_day, repeat_type, repeat_days, repeat_day, reminder_enabled, source, instruction, start_day, end_day, position, created_at)
  SELECT (i->>'id')::uuid, p.user_id, i->>'title', i->>'notes', i->>'kind', (i->>'time')::time, i->'repeat'->>'type',
         CASE WHEN i->'repeat'->>'type' = 'weekdays' THEN ARRAY(SELECT jsonb_array_elements_text(i->'repeat'->'days')::smallint) END,
         CASE WHEN i->'repeat'->>'type' = 'once' THEN (i->'repeat'->>'day')::date END,
         (i->>'reminderEnabled')::boolean, i->>'source', i->>'instruction', (i->>'startDay')::date, (i->>'endDay')::date, ord::integer, (i->>'createdAt')::timestamptz
  FROM plans p, jsonb_array_elements(p.document->'items') WITH ORDINALITY AS t(i, ord)
  WHERE p.document IS NOT NULL
  ON CONFLICT (id) DO NOTHING;
INSERT INTO task_completions (user_id, plan_item_id, day, completed_at)
  SELECT p.user_id, (c->>'itemId')::uuid, (c->>'day')::date, (c->>'completedAt')::timestamptz
  FROM plans p, jsonb_array_elements(p.document->'completions') AS c
  WHERE p.document IS NOT NULL AND EXISTS (SELECT 1 FROM plan_items pi WHERE pi.id = (c->>'itemId')::uuid)
  ON CONFLICT DO NOTHING;
INSERT INTO reminders (user_id, plan_item_id, time_of_day, enabled)
  SELECT user_id, id, time_of_day, reminder_enabled FROM plan_items ON CONFLICT DO NOTHING;

-- ── Timeline, mood, consents ──────────────────────────────────────────────
ALTER TABLE timeline_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE timeline_events ADD CONSTRAINT timeline_events_type_check CHECK (event_type IN ('symptom', 'medication', 'measurement', 'report', 'image', 'chat', 'note', 'appointment'));
ALTER TABLE timeline_events ADD CONSTRAINT timeline_events_source_check CHECK (source_type IN ('user_entered', 'device', 'document', 'clinician', 'ai_summary'));
ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE consents ADD CONSTRAINT consents_kind_check CHECK (kind IN ('ai_processing', 'document_processing', 'health_data_sync', 'voice'));

-- ── Care ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS care_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  specialty text CHECK (specialty IS NULL OR char_length(specialty) <= 120),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  address text CHECK (address IS NULL OR char_length(address) <= 300),
  website text CHECK (website IS NULL OR website ~ '^https?://'),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS care_providers_user_idx ON care_providers(user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  care_provider_id uuid REFERENCES care_providers(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text CHECK (location IS NULL OR char_length(location) <= 300),
  mode text CHECK (mode IS NULL OR mode IN ('in_person', 'video', 'phone')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS appointments_user_idx ON appointments(user_id, starts_at) WHERE deleted_at IS NULL;

-- ── updated_at triggers ───────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'profiles', 'health_conditions', 'allergies', 'medications', 'symptoms', 'symptom_events',
    'health_measurements', 'healthkit_connections', 'conversations', 'messages', 'message_attachments',
    'health_memories', 'medical_documents', 'document_analysis', 'document_extractions', 'document_pages',
    'health_images', 'image_analysis', 'plans', 'plan_items', 'task_completions', 'reminders',
    'timeline_events', 'mood_checkins', 'care_providers', 'appointments'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_updated_at', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;
