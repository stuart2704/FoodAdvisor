ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "booking_url" text,
  ADD COLUMN IF NOT EXISTS "booking_provider" text,
  ADD COLUMN IF NOT EXISTS "booking_status" text,
  ADD COLUMN IF NOT EXISTS "booking_verified_at" timestamp with time zone;