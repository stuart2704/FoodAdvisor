-- Additive only; apply to the confirmed application database before enabling
-- the public request form or government-source review controls.
CREATE TABLE IF NOT EXISTS government_import_sources (
  source text PRIMARY KEY,
  approved boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT true,
  cursor text,
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS government_import_runs (
  id serial PRIMARY KEY,
  source text NOT NULL,
  run_day date NOT NULL,
  status text NOT NULL,
  scanned integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS government_import_run_source_day_unique
  ON government_import_runs (source, run_day);

CREATE TABLE IF NOT EXISTS government_import_decisions (
  id serial PRIMARY KEY,
  source text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_listing_requests (
  id serial PRIMARY KEY,
  kind text NOT NULL,
  restaurant_name text NOT NULL,
  city text NOT NULL,
  address text NOT NULL,
  contact_name text NOT NULL,
  business_email text NOT NULL,
  website text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);