ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS region_budget INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_region_budget_nonnegative CHECK (region_budget >= 0),
  ADD COLUMN IF NOT EXISTS region_budget_used INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_region_budget_used_nonnegative CHECK (region_budget_used >= 0);