-- Insert the former canonical slug when renaming a city or region. Update
-- target_name for all existing aliases in the same transaction as the rename.
-- Slugs must remain unique within each kind; current canonical names take
-- precedence in route resolution.
CREATE TABLE IF NOT EXISTS location_slug_aliases (
  kind TEXT NOT NULL CHECK (kind IN ('city', 'region')),
  slug TEXT NOT NULL CHECK (length(slug) <= 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  target_name TEXT NOT NULL CHECK (length(target_name) > 0),
  CONSTRAINT location_slug_aliases_kind_slug_unique UNIQUE (kind, slug)
);