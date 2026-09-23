ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;

ALTER TABLE "restaurants"
  ALTER COLUMN "updated_at" SET DEFAULT NOW();