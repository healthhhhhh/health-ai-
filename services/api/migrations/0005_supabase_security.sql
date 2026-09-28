-- Supabase Auth linkage, Row Level Security and private Storage buckets.
--
-- Clients (iOS, web) only ever hold the publishable key and the person's own
-- session. The NestJS API connects as a privileged database role and still
-- filters every query by the authenticated user; RLS is the second, independent
-- guarantee that one person can never read or change another person's data —
-- including through Supabase's Data API with a valid user session.

-- ── Auth linkage ──────────────────────────────────────────────────────────
-- Every Supabase Auth user gets a HealthMate user + profile (same id).
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users (id, email, password_hash, auth_provider)
    VALUES (NEW.id, lower(coalesce(NEW.email, NEW.id::text || '@users.invalid')), NULL, 'supabase')
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
DROP TRIGGER IF EXISTS healthmate_on_auth_user_created ON auth.users;
CREATE TRIGGER healthmate_on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Deleting the Auth user deletes all of their HealthMate rows (cascades from users).
CREATE OR REPLACE FUNCTION public.handle_deleted_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.users WHERE id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS healthmate_on_auth_user_deleted ON auth.users;
CREATE TRIGGER healthmate_on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_deleted_auth_user();

-- ── Row Level Security ────────────────────────────────────────────────────
-- Enable on every table in public; the anon role gets nothing.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON public.healthkit_measurements, public.tasks FROM anon;
GRANT SELECT ON public.healthkit_measurements, public.tasks TO authenticated;

-- Helper: policies for "the owner may <commands> their own rows".
CREATE OR REPLACE FUNCTION public.healthmate_owner_policies(tbl text, commands text[], owner_column text DEFAULT 'user_id') RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE cmd text;
BEGIN
  FOREACH cmd IN ARRAY commands LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'own_' || lower(cmd), tbl);
    IF cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%I = (SELECT auth.uid()))', 'own_insert', tbl, owner_column);
    ELSIF cmd = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%I = (SELECT auth.uid())) WITH CHECK (%I = (SELECT auth.uid()))', 'own_update', tbl, owner_column, owner_column);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO authenticated USING (%I = (SELECT auth.uid()))', 'own_' || lower(cmd), tbl, cmd, owner_column);
    END IF;
  END LOOP;
END $$;

-- Account & profile: read own; profile editable.
SELECT public.healthmate_owner_policies('users', ARRAY['SELECT'], 'id');
SELECT public.healthmate_owner_policies('profiles', ARRAY['SELECT', 'UPDATE']);

-- Person-authored health records: full access to own rows.
SELECT public.healthmate_owner_policies('health_conditions', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('allergies', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('medications', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('symptoms', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('symptom_events', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('mood_checkins', ARRAY['SELECT', 'INSERT']);
SELECT public.healthmate_owner_policies('consents', ARRAY['SELECT', 'INSERT']); -- append-only history
SELECT public.healthmate_owner_policies('care_providers', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);
SELECT public.healthmate_owner_policies('appointments', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']);

-- Written by the API (validation, consent, revisions, AI pipeline): read own only.
SELECT public.healthmate_owner_policies('health_measurements', ARRAY['SELECT', 'DELETE']);
SELECT public.healthmate_owner_policies('healthkit_connections', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('conversations', ARRAY['SELECT', 'DELETE']);
SELECT public.healthmate_owner_policies('messages', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('message_attachments', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('medical_documents', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('document_analysis', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('document_extractions', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('document_pages', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('health_images', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('image_analysis', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('plans', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('plan_items', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('task_completions', ARRAY['SELECT']);
SELECT public.healthmate_owner_policies('reminders', ARRAY['SELECT']);

-- Health memory: people add facts they report or confirm; AI inferences are
-- created only by the server and are never confirmed without the person.
DROP POLICY IF EXISTS own_select ON public.health_memories;
CREATE POLICY own_select ON public.health_memories FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_insert ON public.health_memories;
CREATE POLICY own_insert ON public.health_memories FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status IN ('user_reported', 'user_confirmed'));
DROP POLICY IF EXISTS own_update ON public.health_memories;
CREATE POLICY own_update ON public.health_memories FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()) AND status IN ('user_reported', 'user_confirmed', 'superseded'));
DROP POLICY IF EXISTS own_delete ON public.health_memories;
CREATE POLICY own_delete ON public.health_memories FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- Timeline: read own; people may add and remove only their own entries.
DROP POLICY IF EXISTS own_select ON public.timeline_events;
CREATE POLICY own_select ON public.timeline_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_insert ON public.timeline_events;
CREATE POLICY own_insert ON public.timeline_events FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND source_type = 'user_entered' AND event_type IN ('symptom', 'note', 'medication', 'appointment'));
DROP POLICY IF EXISTS own_delete ON public.timeline_events;
CREATE POLICY own_delete ON public.timeline_events FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()) AND source_type = 'user_entered');

-- No policies (server only): refresh_tokens, ai_usage, safety_events,
-- audit_logs, documents_legacy, schema_migrations.

-- ── Private Storage buckets ───────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('medical-reports', 'medical-reports', false, 20971520, ARRAY['application/pdf', 'image/jpeg', 'image/png']),
  ('health-images', 'health-images', false, 20971520, ARRAY['image/jpeg', 'image/png']),
  ('avatars', 'avatars', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Objects live at <user id>/<record id>. People can read only their own
-- folder. Medical uploads happen through short-lived signed upload URLs issued
-- by the API after its ownership checks; deletion goes through the API too.
DROP POLICY IF EXISTS healthmate_read_own_files ON storage.objects;
CREATE POLICY healthmate_read_own_files ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('medical-reports', 'health-images', 'avatars') AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS healthmate_write_own_avatar ON storage.objects;
CREATE POLICY healthmate_write_own_avatar ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
DROP POLICY IF EXISTS healthmate_delete_own_avatar ON storage.objects;
CREATE POLICY healthmate_delete_own_avatar ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
