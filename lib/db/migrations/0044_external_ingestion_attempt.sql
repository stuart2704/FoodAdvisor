ALTER TABLE external_ingestion_schedule
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_summary text;