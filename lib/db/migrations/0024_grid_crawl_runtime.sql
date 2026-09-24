ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS grid_hash TEXT,
  ADD COLUMN IF NOT EXISTS next_index INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_next_index_nonnegative CHECK (next_index >= 0),
  ADD COLUMN IF NOT EXISTS pending_index INTEGER
    CONSTRAINT crawler_progress_pending_index_nonnegative CHECK (pending_index IS NULL OR pending_index >= 0),
  ADD COLUMN IF NOT EXISTS attempt_date DATE NOT NULL DEFAULT (timezone('UTC', now())::date),
  ADD COLUMN IF NOT EXISTS attempted_today INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_attempted_today_range CHECK (attempted_today BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS monthly_budget_cents INTEGER NOT NULL DEFAULT 3000
    CONSTRAINT crawler_progress_monthly_budget_range CHECK (monthly_budget_cents BETWEEN 50 AND 3000);

CREATE TABLE IF NOT EXISTS region_progress (
  region_name TEXT PRIMARY KEY,
  budget_month DATE NOT NULL,
  region_budget INTEGER NOT NULL DEFAULT 0
    CONSTRAINT region_progress_budget_nonnegative CHECK (region_budget >= 0),
  region_budget_used INTEGER NOT NULL DEFAULT 0
    CONSTRAINT region_progress_used_nonnegative CHECK (region_budget_used >= 0),
  region_interval INTEGER NOT NULL DEFAULT 3
    CONSTRAINT region_progress_interval_range CHECK (region_interval BETWEEN 1 AND 7),
  next_region_run DATE,
  last_run DATE
);

ALTER TABLE city_progress
  ADD COLUMN IF NOT EXISTS budget_month DATE NOT NULL
    DEFAULT date_trunc('month', timezone('UTC', now()))::date;