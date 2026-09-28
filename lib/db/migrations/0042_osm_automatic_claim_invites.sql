-- Contact authority is explicitly reviewed, never inferred from OSM tags or import.
ALTER TABLE osm_candidate_workflows
  ADD COLUMN IF NOT EXISTS approved_contact_email text,
  ADD COLUMN IF NOT EXISTS contact_evidence text,
  ADD COLUMN IF NOT EXISTS contact_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_approved_by text,
  ADD COLUMN IF NOT EXISTS auto_invite_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS osm_candidate_auto_invite_due_idx
  ON osm_candidate_workflows (reviewed_at, source_id)
  WHERE source_name = 'OSM' AND auto_invite_enabled = true;