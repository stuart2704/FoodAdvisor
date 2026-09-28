ALTER TABLE social_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ;
ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS worker_success_at TIMESTAMPTZ;
ALTER TABLE social_settings ADD COLUMN IF NOT EXISTS worker_failure_at TIMESTAMPTZ;