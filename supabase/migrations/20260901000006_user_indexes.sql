-- Generated from services/api/migrations/0006_user_indexes.sql by scripts/supabase-migrations.mjs. Do not edit.

-- Index user_id on every per-user table that lacked one: RLS policies,
-- exports and account deletion all filter on it.
CREATE INDEX IF NOT EXISTS messages_user_idx ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS message_attachments_user_idx ON message_attachments(user_id);
CREATE INDEX IF NOT EXISTS document_analysis_user_idx ON document_analysis(user_id);
CREATE INDEX IF NOT EXISTS document_pages_user_idx ON document_pages(user_id);
CREATE INDEX IF NOT EXISTS image_analysis_user_idx ON image_analysis(user_id);
CREATE INDEX IF NOT EXISTS safety_events_user_idx ON safety_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage(user_id, created_at);
