ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS cycle_number INTEGER NOT NULL DEFAULT 1
    CONSTRAINT crawler_progress_cycle_number_positive CHECK (cycle_number >= 1),
  ADD COLUMN IF NOT EXISTS cycle_completed BOOLEAN NOT NULL DEFAULT FALSE;