ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT NOW();