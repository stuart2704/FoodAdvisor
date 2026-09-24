ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS next_region_run DATE,
  ADD COLUMN IF NOT EXISTS region_interval INTEGER NOT NULL DEFAULT 3
    CONSTRAINT crawler_progress_region_interval_range
      CHECK (region_interval BETWEEN 1 AND 7);