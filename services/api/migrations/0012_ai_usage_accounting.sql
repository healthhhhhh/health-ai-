-- AI Gateway accounting: every AI request is recorded with its task, provider,
-- model, billing period, token counts, estimated and priced cost and status.
-- Operational data only (no prompts, answers or health content); server-only
-- (RLS on, no policies). Used for the internal monthly cost limit, never shown
-- to people.

ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS task text,
  ADD COLUMN IF NOT EXISTS provider text,
  -- Accounting month, UTC, e.g. '2026-09'.
  ADD COLUMN IF NOT EXISTS billing_period text,
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer NOT NULL DEFAULT 0,
  -- Before the call, from the request size and the task's expected output.
  ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  -- After the call, from the reported token usage (or the provider's billed amount).
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text,
  -- Urgent-symptom answers are never refused by the cost limit.
  ADD COLUMN IF NOT EXISTS safety_critical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_issue_count integer NOT NULL DEFAULT 0;

-- Earlier rows: map the old feature names and outcomes.
UPDATE ai_usage SET
  task = COALESCE(task, CASE feature WHEN 'chat' THEN 'health_chat' WHEN 'document_extraction' THEN 'report_analysis' ELSE feature END),
  provider = COALESCE(provider, 'unknown'),
  billing_period = COALESCE(billing_period, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM')),
  status = COALESCE(status, CASE outcome WHEN 'ok' THEN 'ok' WHEN 'AiDeclinedError' THEN 'declined' WHEN 'AiInvalidOutputError' THEN 'invalid_output' WHEN 'AiUnavailableError' THEN 'unavailable' ELSE 'error' END)
WHERE task IS NULL OR provider IS NULL OR billing_period IS NULL OR status IS NULL;

ALTER TABLE ai_usage ALTER COLUMN task SET NOT NULL;
ALTER TABLE ai_usage ALTER COLUMN provider SET NOT NULL;
ALTER TABLE ai_usage ALTER COLUMN billing_period SET NOT NULL;
ALTER TABLE ai_usage ALTER COLUMN status SET NOT NULL;

ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_task_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_task_check
  CHECK (task IN ('health_chat', 'complex_health', 'report_analysis', 'image_analysis', 'task_generation', 'summarization'));
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_status_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_status_check
  CHECK (status IN ('ok', 'flagged', 'invalid_output', 'declined', 'unavailable', 'budget_exceeded', 'error'));
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_billing_period_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_billing_period_check CHECK (billing_period ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_cost_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_cost_check CHECK (cost_usd >= 0 AND estimated_cost_usd >= 0);

-- The monthly limit sums one person's cost for the current period.
CREATE INDEX IF NOT EXISTS ai_usage_user_period_idx ON ai_usage(user_id, billing_period);
