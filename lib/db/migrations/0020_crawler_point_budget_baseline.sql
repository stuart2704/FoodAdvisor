ALTER TABLE crawler_progress
  ADD COLUMN IF NOT EXISTS paid_requests_last_point INTEGER NOT NULL DEFAULT 0
    CONSTRAINT crawler_progress_paid_requests_last_point_nonnegative
      CHECK (paid_requests_last_point >= 0);