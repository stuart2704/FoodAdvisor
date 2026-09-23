ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_checkout_attempt_id text;

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;