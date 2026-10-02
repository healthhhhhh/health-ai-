-- Generated from services/api/migrations/0015_age_and_consent_foundation.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Age & consent Phase 2A: record each person's age band and its history.
-- Recording only — nothing is restricted by age yet (AGE_ENFORCEMENT is off or
-- record; `enforce` is refused by configuration). No parental accounts.
--
-- Age is assessed by the API only (POST /v1/me/age, or an optional age screen at
-- sign-up), from a date of birth it validates itself. No new date of birth is
-- stored by this feature: only the band, where it came from and when.

-- ── Current age state on the account ──────────────────────────────────────
-- Every existing account starts as unknown. Bands are never inferred from
-- profiles.date_of_birth, which stays as it is (an optional profile field).
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_band text NOT NULL DEFAULT 'unknown';
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_assessed_at timestamptz;
UPDATE users SET age_band = 'unknown', age_status = 'unknown' WHERE age_assessed_at IS NULL AND (age_band <> 'unknown' OR age_status <> 'unknown');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_age_band_check;
ALTER TABLE users ADD CONSTRAINT users_age_band_check CHECK (age_band IN ('unknown', 'under_13', '13_15', '16_17', 'adult'));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_age_status_check;
ALTER TABLE users ADD CONSTRAINT users_age_status_check CHECK (age_status IN ('unknown', 'in_scope', 'blocked_under_13', 'blocked_out_of_scope', 'review'));
-- Unknown means never assessed: band, status and timestamp move together.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_age_state_check;
ALTER TABLE users ADD CONSTRAINT users_age_state_check CHECK (
  (age_band = 'unknown') = (age_status = 'unknown') AND (age_band = 'unknown') = (age_assessed_at IS NULL)
);

-- ── Assessment history (append-only, written by the API) ──────────────────
CREATE TABLE IF NOT EXISTS age_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The band this assessment indicated (computed by the server).
  band text NOT NULL CHECK (band IN ('under_13', '13_15', '16_17', 'adult')),
  source text NOT NULL CHECK (source IN ('self_declared', 'apple_declared_age_range', 'app_store_signal', 'support', 'parent_declared')),
  -- applied: became the account's band; review: conflicted with an earlier, younger band and was held for review.
  outcome text NOT NULL CHECK (outcome IN ('applied', 'review')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS age_assessments_user_idx ON age_assessments(user_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- People can read their own history through the Data API; only the API writes.
ALTER TABLE public.age_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.age_assessments FROM anon, authenticated;
GRANT SELECT ON public.age_assessments TO authenticated;
SELECT public.healthmate_owner_policies('age_assessments', ARRAY['SELECT']);

-- users already has only an owner SELECT policy (0005), so RLS refuses client
-- writes; remove the write privileges too, so age state can't be changed even
-- if a policy were added later by mistake.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;
