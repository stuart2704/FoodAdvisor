-- Additive OSM candidate review, claim, rights, and publication workflow.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS source_attribution text,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_description text,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE restaurants
  ALTER COLUMN google_maps_url DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurants_source_identity_unique
  ON restaurants(source_name, source_id);

CREATE TABLE IF NOT EXISTS osm_candidate_workflows (
  source_name text NOT NULL,
  source_id text NOT NULL,
  state text NOT NULL DEFAULT 'unverified',
  reviewed boolean NOT NULL DEFAULT false,
  claimed boolean NOT NULL DEFAULT false,
  identity_verified boolean NOT NULL DEFAULT false,
  rights_confirmed boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  suppressed boolean NOT NULL DEFAULT false,
  suppressed_at timestamptz,
  suppressed_reason text,
  suppressed_by text,
  outreach_blocked boolean NOT NULL DEFAULT false,
  high_confidence boolean NOT NULL DEFAULT false,
  invite_count integer NOT NULL DEFAULT 0,
  reviewed_at timestamptz,
  owner_draft jsonb NOT NULL,
  owner_outreach_disabled boolean NOT NULL DEFAULT false,
  restaurant_place_id text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osm_candidate_workflows_pkey PRIMARY KEY (source_name, source_id),
  CONSTRAINT osm_candidate_workflows_external_candidate_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES external_candidates(source_name, source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS osm_candidate_workflows_state_idx
  ON osm_candidate_workflows(state, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS osm_candidate_workflows_restaurant_unique
  ON osm_candidate_workflows(restaurant_place_id);

CREATE TABLE IF NOT EXISTS osm_claim_invites (
  id serial PRIMARY KEY,
  source_name text NOT NULL,
  source_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  sent_to text NOT NULL,
  method text NOT NULL,
  status text NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  provider_sent_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT osm_claim_invites_workflow_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES osm_candidate_workflows(source_name, source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS osm_claim_invites_candidate_created_idx
  ON osm_claim_invites(source_name, source_id, created_at);
CREATE INDEX IF NOT EXISTS osm_claim_invites_candidate_sent_idx
  ON osm_claim_invites(source_name, source_id, provider_sent_at);

CREATE TABLE IF NOT EXISTS osm_owner_sessions (
  token_hash text PRIMARY KEY,
  source_name text NOT NULL,
  source_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT osm_owner_sessions_workflow_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES osm_candidate_workflows(source_name, source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS osm_owner_sessions_candidate_idx
  ON osm_owner_sessions(source_name, source_id, expires_at);

CREATE TABLE IF NOT EXISTS osm_verification_codes (
  id serial PRIMARY KEY,
  owner_session_hash text NOT NULL
    REFERENCES osm_owner_sessions(token_hash) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS osm_verification_codes_session_created_idx
  ON osm_verification_codes(owner_session_hash, created_at);

CREATE TABLE IF NOT EXISTS osm_candidate_evidence (
  id serial PRIMARY KEY,
  source_name text NOT NULL,
  source_id text NOT NULL,
  kind text NOT NULL,
  description text NOT NULL,
  evidence_url text,
  source_attribution text,
  status text NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reviewer_note text,
  CONSTRAINT osm_candidate_evidence_workflow_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES osm_candidate_workflows(source_name, source_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS osm_candidate_evidence_candidate_kind_unique
  ON osm_candidate_evidence(source_name, source_id, kind);
CREATE INDEX IF NOT EXISTS osm_candidate_evidence_status_idx
  ON osm_candidate_evidence(status, submitted_at);

CREATE TABLE IF NOT EXISTS osm_outreach_logs (
  id serial PRIMARY KEY,
  source_name text NOT NULL,
  source_id text NOT NULL,
  invite_id integer REFERENCES osm_claim_invites(id) ON DELETE SET NULL,
  sent_to text,
  method text NOT NULL,
  status text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osm_outreach_logs_workflow_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES osm_candidate_workflows(source_name, source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS osm_outreach_logs_candidate_created_idx
  ON osm_outreach_logs(source_name, source_id, created_at);

CREATE TABLE IF NOT EXISTS osm_activation_states (
  source_name text NOT NULL,
  source_id text NOT NULL,
  promoted boolean NOT NULL DEFAULT false,
  enriched boolean NOT NULL DEFAULT false,
  scored boolean NOT NULL DEFAULT false,
  published boolean NOT NULL DEFAULT false,
  current_step text,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT osm_activation_states_pkey PRIMARY KEY (source_name, source_id),
  CONSTRAINT osm_activation_states_workflow_fk
    FOREIGN KEY (source_name, source_id)
    REFERENCES osm_candidate_workflows(source_name, source_id) ON DELETE CASCADE
);

-- Existing OSM data starts in the new review state; import history alone never
-- counts as review, invitation, identity verification, rights approval, or publication.
INSERT INTO osm_candidate_workflows (
  source_name,
  source_id,
  state,
  reviewed,
  suppressed,
  high_confidence,
  owner_draft
)
SELECT
  source_name,
  source_id,
  CASE
    WHEN verification_status = 'rejected' THEN 'suppressed'
    ELSE 'unverified'
  END,
  false,
  verification_status = 'rejected',
  verification_status = 'review_ready',
  jsonb_build_object(
    'name', raw_name,
    'address', raw_address,
    'city', NULL,
    'phone', raw_phone,
    'website', raw_website,
    'description', NULL,
    'openingHours', '[]'::jsonb,
    'latitude', raw_lat,
    'longitude', raw_lon
  )
FROM external_candidates
WHERE source_name = 'OSM'
ON CONFLICT (source_name, source_id) DO NOTHING;