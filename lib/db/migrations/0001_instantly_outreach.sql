-- Idempotent additive migration. It is safe for the normal deployment flow;
-- do not run it manually against production.
CREATE TABLE IF NOT EXISTS instantly_outreach_campaigns (
  campaign_id text PRIMARY KEY,
  place_id text NOT NULL UNIQUE REFERENCES restaurants(place_id),
  recipient_email text NOT NULL,
  eaccount text NOT NULL,
  lead_id text UNIQUE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS processed_instantly_messages (
  message_id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES instantly_outreach_campaigns(campaign_id),
  place_id text NOT NULL REFERENCES restaurants(place_id),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instantly_followup_campaigns (
  campaign_id text PRIMARY KEY,
  place_id text NOT NULL REFERENCES restaurants(place_id),
  email_number integer NOT NULL,
  recipient_email text NOT NULL,
  eaccount text NOT NULL,
  lead_id text UNIQUE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  activated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS instantly_followup_campaign_place_step_unique
  ON instantly_followup_campaigns(place_id, email_number);

CREATE TABLE IF NOT EXISTS processed_instantly_followup_messages (
  message_id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES instantly_followup_campaigns(campaign_id),
  place_id text NOT NULL REFERENCES restaurants(place_id),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instantly_sent_messages (
  message_id text PRIMARY KEY,
  campaign_id text NOT NULL UNIQUE,
  place_id text NOT NULL REFERENCES restaurants(place_id),
  email_number integer NOT NULL,
  sent_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instantly_inbox_state (
  eaccount text PRIMARY KEY,
  next_starting_after text,
  last_fully_reconciled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instantly_campaign_cancellations (
  campaign_id text PRIMARY KEY,
  place_id text NOT NULL REFERENCES restaurants(place_id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);