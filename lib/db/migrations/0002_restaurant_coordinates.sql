-- Additive and idempotent: existing restaurant rows remain valid and retain
-- all existing outreach/claim data. Coordinates are populated only by an
-- explicitly approved Places import, never by a startup backfill.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS latitude double precision;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS longitude double precision;