-- Apply before deploying the checkout reconciliation worker.
CREATE TABLE IF NOT EXISTS stripe_checkout_alerts (
  session_id text PRIMARY KEY,
  restaurant_id text NOT NULL,
  customer_id text NOT NULL,
  subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_observed_at timestamptz,
  alerted_at timestamptz,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS stripe_checkout_alerts_unresolved_idx
  ON stripe_checkout_alerts (resolved_at, created_at);