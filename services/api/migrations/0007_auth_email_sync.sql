-- Keep public.users.email in step when someone changes their email in
-- Supabase Auth (after they confirm the change).
CREATE OR REPLACE FUNCTION public.handle_updated_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.users SET email = lower(NEW.email) WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS healthmate_on_auth_user_updated ON auth.users;
CREATE TRIGGER healthmate_on_auth_user_updated AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_updated_auth_user();

-- Trigger functions are not callable through the Data API.
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_deleted_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.healthmate_owner_policies(text, text[], text) FROM PUBLIC, anon, authenticated;
