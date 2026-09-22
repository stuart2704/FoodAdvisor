CREATE TABLE IF NOT EXISTS engine_heartbeats (
  engine text PRIMARY KEY,
  last_heartbeat timestamptz NOT NULL DEFAULT now()
);