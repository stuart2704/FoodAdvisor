-- Temporary provider metadata only; never store image bytes.
-- Apply this additive migration before deploying the shared photo lookup.
CREATE TABLE place_photo_lookup_cache (
  cache_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('details', 'media')),
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX place_photo_lookup_cache_expiry_idx ON place_photo_lookup_cache (expires_at);