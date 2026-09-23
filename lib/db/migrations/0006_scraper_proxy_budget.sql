-- Separate from Google Places: USD microdollars, lifetime cap, no auto-reset.
-- Apply explicitly before considering browser enablement. Missing schema blocks scans.
CREATE TABLE IF NOT EXISTS scraper_proxy_budget (
  id integer PRIMARY KEY CHECK (id = 1),
  cap_micros bigint NOT NULL CHECK (cap_micros > 0),
  reserved_micros bigint NOT NULL DEFAULT 0
    CHECK (reserved_micros >= 0 AND reserved_micros <= cap_micros)
);
CREATE TABLE IF NOT EXISTS scraper_proxy_reservations (
  id uuid PRIMARY KEY,
  scan_type text NOT NULL CHECK (scan_type IN ('maps', 'website')),
  amount_micros bigint NOT NULL CHECK (amount_micros > 0),
  pricing jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);