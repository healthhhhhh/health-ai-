-- Phase 2C: long-term health memory controls. See docs/phase2c-plan.md.
--
-- A memory's temporal status (current / historical / superseded) is derived
-- from ended_on and status, never stored twice. People can keep a fact but
-- stop the AI Health Assistant from using it (ai_excluded), and can see when a
-- fact last informed an answer (last_used_at).

ALTER TABLE health_memories
  ADD COLUMN IF NOT EXISTS ai_excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- Retrieval only ever considers facts the AI may use.
CREATE INDEX IF NOT EXISTS health_memories_ai_usable_idx ON health_memories(user_id, updated_at DESC)
  WHERE status <> 'superseded' AND NOT ai_excluded;
CREATE INDEX IF NOT EXISTS health_memories_category_idx ON health_memories(user_id, category) WHERE category IS NOT NULL;

-- People may also change these two columns on their own rows (the RLS update
-- policy from 0005 already limits rows to their own and statuses to theirs).
