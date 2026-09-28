ALTER TABLE "restaurant_collections"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;