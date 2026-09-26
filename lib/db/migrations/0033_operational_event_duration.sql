-- Only bounded numeric timings for completed operations; legacy events remain unmeasured.
ALTER TABLE operational_log_events
  ADD COLUMN IF NOT EXISTS duration_ms integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operational_log_events_duration_ms_check'
  ) THEN
    ALTER TABLE operational_log_events
      ADD CONSTRAINT operational_log_events_duration_ms_check
      CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 600000);
  END IF;
END $$;