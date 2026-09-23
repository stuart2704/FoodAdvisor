CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_stripe_customer_unique"
  ON "restaurants" ("stripe_customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "restaurants_stripe_subscription_unique"
  ON "restaurants" ("stripe_subscription_id");

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text;

ALTER TABLE "restaurants"
  ADD COLUMN IF NOT EXISTS "stripe_checkout_attempt" integer NOT NULL DEFAULT 0;