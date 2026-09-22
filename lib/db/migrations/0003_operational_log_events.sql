-- Sanitized admin-only operational events. Raw request/provider metadata is
-- intentionally excluded. All rows are deleted after seven days.
CREATE TABLE IF NOT EXISTS operational_log_events (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  message text NOT NULL,
  category text,
  bookmarked boolean NOT NULL DEFAULT false,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[]
);

CREATE INDEX IF NOT EXISTS operational_log_events_created_at_idx
  ON operational_log_events (created_at DESC);

CREATE INDEX IF NOT EXISTS operational_log_events_type_created_at_idx
  ON operational_log_events (type, created_at DESC);