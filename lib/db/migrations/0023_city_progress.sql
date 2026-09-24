CREATE TABLE IF NOT EXISTS city_progress (
  id SERIAL PRIMARY KEY,
  region_name TEXT NOT NULL,
  city_name TEXT NOT NULL,
  city_budget INTEGER NOT NULL DEFAULT 0
    CONSTRAINT city_progress_budget_nonnegative CHECK (city_budget >= 0),
  city_budget_used INTEGER NOT NULL DEFAULT 0
    CONSTRAINT city_progress_budget_used_nonnegative CHECK (city_budget_used >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS city_progress_region_city_unique
  ON city_progress (region_name, city_name);