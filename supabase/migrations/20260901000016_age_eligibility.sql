-- Generated from services/api/migrations/0016_age_eligibility.sql by scripts/supabase-migrations.mjs. Do not edit.

-- US launch age eligibility (adults and 13–17; under-13 excluded).
--
-- With AGE_ENFORCEMENT=enforce the API serves only accounts whose age band is
-- enabled. This migration adds what enforcement needs:
--   * age_adult_on — for 13–17-year-olds only, the date they turn 18 by the
--     date of birth they declared, so their band follows their birthdays
--     (13–15 → 16–17 → adult) without asking again. It carries the same
--     information as the date of birth: never sent to AI, never logged, part of
--     the export, deleted with the account. Null for adults, under-13s and
--     unknown ages.
--   * age_deletion_due_at — when an account found to belong to someone under 13
--     is deleted (the account is restricted from the moment it's found).
--   * a `birthday` source in the age history for those automatic band changes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS age_adult_on date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS age_deletion_due_at timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_age_adult_on_check;
ALTER TABLE users ADD CONSTRAINT users_age_adult_on_check CHECK (age_adult_on IS NULL OR age_band IN ('13_15', '16_17'));

ALTER TABLE age_assessments DROP CONSTRAINT IF EXISTS age_assessments_source_check;
ALTER TABLE age_assessments ADD CONSTRAINT age_assessments_source_check
  CHECK (source IN ('self_declared', 'apple_declared_age_range', 'app_store_signal', 'support', 'parent_declared', 'birthday'));

-- The maintenance sweep looks for accounts due for deletion.
CREATE INDEX IF NOT EXISTS users_age_deletion_due_idx ON users(age_deletion_due_at) WHERE age_deletion_due_at IS NOT NULL;
