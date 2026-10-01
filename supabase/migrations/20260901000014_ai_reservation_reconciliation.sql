-- Generated from services/api/migrations/0014_ai_reservation_reconciliation.sql by scripts/supabase-migrations.mjs. Do not edit.

-- A reservation that expired (its request outlived the reservation's lifetime)
-- was charged its full worst case. If that request does finish and reports more
-- usage than was charged, the difference is added once: reconciled_at marks
-- that final adjustment, so an expired reservation can be finalised at most
-- once more and never charged less than before.
ALTER TABLE ai_budget_reservations ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
