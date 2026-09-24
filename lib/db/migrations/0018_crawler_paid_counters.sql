ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS paid_requests_today INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_paid_requests_today_nonnegative CHECK (paid_requests_today >= 0),
  ADD COLUMN IF NOT EXISTS paid_requests_month INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_paid_requests_month_nonnegative CHECK (paid_requests_month >= 0),
  ADD COLUMN IF NOT EXISTS last_paid_reset DATE NOT NULL DEFAULT (timezone('UTC', now())::date);