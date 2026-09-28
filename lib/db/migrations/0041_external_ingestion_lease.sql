-- Shared by scheduled and manual imports. Apply before deploying the lease-based runner.
CREATE TABLE IF NOT EXISTS external_ingestion_lease (
  id text PRIMARY KEY,
  owner_token text NOT NULL,
  expires_at timestamptz NOT NULL
);