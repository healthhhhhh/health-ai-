-- Phase 2D (free-only): Google sign-in identities and push-notification devices.
-- Apple sign-in reuses auth_identities later; APNs delivery reuses push_devices.

-- Accounts created with Google (or later Apple) have no password. Password
-- sign-in still fails safely for them (AuthService.login).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_local_password_check;

-- One row per external identity linked to a HealthMate account. The subject
-- (`sub`) is the provider's stable id; the email is a snapshot for display.
CREATE TABLE IF NOT EXISTS auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities(user_id);

-- Devices that may receive push notifications. The token is stored encrypted
-- (AES-256-GCM, key only on the server) with a SHA-256 hash for lookups; it is
-- never returned by the API. A token belongs to one account at a time.
CREATE TABLE IF NOT EXISTS push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('ios')),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  token_ciphertext text NOT NULL CHECK (char_length(token_ciphertext) <= 1024),
  app_version text CHECK (app_version IS NULL OR char_length(app_version) <= 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the push service reports the token is no longer valid.
  disabled_at timestamptz,
  disabled_reason text CHECK (disabled_reason IS NULL OR char_length(disabled_reason) <= 64)
);
CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id) WHERE disabled_at IS NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Identities: people can see which sign-in methods are linked; the API writes.
-- Push devices: server-only (no policies), like refresh tokens.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth_identities', 'push_devices'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
GRANT SELECT ON public.auth_identities TO authenticated;
REVOKE ALL ON public.push_devices FROM authenticated;
SELECT public.healthmate_owner_policies('auth_identities', ARRAY['SELECT']);
