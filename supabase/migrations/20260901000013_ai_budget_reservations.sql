-- Generated from services/api/migrations/0013_ai_budget_reservations.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Atomic AI cost protection. Before a paid call, the gateway reserves the
-- request's worst-case cost against the person's monthly ledger with one
-- conditional UPDATE (row-locked), so concurrent requests can't jointly pass
-- the limit. After the call the reservation is settled at the priced reported
-- usage (or kept at the worst case when usage is unknown), or released when
-- nothing was processed. Settling is idempotent: a retry can't charge twice.
-- Server-only (RLS on, no policies). No health content.

CREATE TABLE IF NOT EXISTS ai_budget_periods (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_period text NOT NULL CHECK (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- Settled cost this period (USD).
  spent_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  -- Held by in-flight requests (USD).
  reserved_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, billing_period)
);

CREATE TABLE IF NOT EXISTS ai_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  billing_period text NOT NULL CHECK (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  task text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  amount_usd numeric(12, 6) NOT NULL CHECK (amount_usd >= 0),
  safety_critical boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'settled', 'released', 'expired')),
  charged_usd numeric(12, 6) CHECK (charged_usd IS NULL OR charged_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A reservation still held after this (crashed process) is charged in full.
  expires_at timestamptz NOT NULL,
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_budget_reservations_held_idx ON ai_budget_reservations(user_id, expires_at) WHERE status = 'held';

-- Each usage row belongs to at most one reservation (no double accounting).
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS reservation_id uuid,
  ADD COLUMN IF NOT EXISTS requested_model text,
  -- usage: priced from reported tokens; reservation: usage unknown, charged the reserved worst case; none: free.
  ADD COLUMN IF NOT EXISTS cost_basis text NOT NULL DEFAULT 'usage',
  ADD COLUMN IF NOT EXISTS price_version text;
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_reservation_unique;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_reservation_unique UNIQUE (reservation_id);
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_cost_basis_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_cost_basis_check CHECK (cost_basis IN ('usage', 'reservation', 'none'));
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_status_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('ok', 'flagged', 'invalid_output', 'declined', 'unavailable', 'budget_exceeded', 'timeout', 'expired', 'unpriced', 'error'));

-- Carry this month's already-recorded spend into the ledger.
INSERT INTO ai_budget_periods (user_id, billing_period, spent_usd)
  SELECT user_id, billing_period, SUM(cost_usd) FROM ai_usage
   WHERE user_id IS NOT NULL AND cost_usd > 0
   GROUP BY user_id, billing_period
ON CONFLICT (user_id, billing_period) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_budget_periods', 'ai_budget_reservations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
