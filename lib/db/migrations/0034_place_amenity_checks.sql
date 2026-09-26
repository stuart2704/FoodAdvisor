-- One attempt per Google Place ID. A pending or failed attempt is never silently retried.
CREATE TABLE IF NOT EXISTS place_amenity_checks (
  place_id text PRIMARY KEY,
  status text NOT NULL CONSTRAINT place_amenity_checks_status_check
    CHECK (status IN ('pending', 'completed', 'failed')),
  reservation_id integer NOT NULL UNIQUE REFERENCES restaurant_import_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);