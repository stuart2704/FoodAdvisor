CREATE TABLE IF NOT EXISTS owner_offer_metrics (
  day date NOT NULL,
  event text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT owner_offer_metrics_pkey PRIMARY KEY (day, event),
  CONSTRAINT owner_offer_metrics_event_check CHECK (event IN ('owner_offer_published', 'owner_offer_updated', 'owner_offer_deleted')),
  CONSTRAINT owner_offer_metrics_count_check CHECK (count >= 0)
);