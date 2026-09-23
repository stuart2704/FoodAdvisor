ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "cuisines" text[],
  ADD COLUMN IF NOT EXISTS "amenities" text[];