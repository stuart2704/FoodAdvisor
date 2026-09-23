CREATE TABLE IF NOT EXISTS crawler_progress (
  id SERIAL PRIMARY KEY,
  last_region_index INTEGER NOT NULL DEFAULT 0,
  last_city_index INTEGER NOT NULL DEFAULT 0,
  last_point_index INTEGER NOT NULL DEFAULT 0,
  last_run TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  paid_requests INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT crawler_progress_singleton CHECK (id = 1),
  CONSTRAINT crawler_progress_indices_nonnegative CHECK (
    last_region_index >= 0 AND last_city_index >= 0 AND last_point_index >= 0
  ),
  CONSTRAINT crawler_progress_paid_requests_nonnegative CHECK (paid_requests >= 0)
);

INSERT INTO crawler_progress (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;