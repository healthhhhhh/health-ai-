-- Each person's plan (tasks, medications, habits and completions) as one
-- validated document with a revision number for conflict detection.
-- Medication instructions are stored exactly as the person entered them.
CREATE TABLE IF NOT EXISTS plans (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
