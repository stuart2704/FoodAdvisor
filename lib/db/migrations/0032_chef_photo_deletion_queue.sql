CREATE TABLE IF NOT EXISTS chef_photo_deletion_queue (
  object_path text PRIMARY KEY,
  due_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chef_photo_deletion_queue_due_idx ON chef_photo_deletion_queue (due_at);
ALTER TABLE chef_photo_upload_intents ADD COLUMN IF NOT EXISTS cleanup_after timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS chef_photo_upload_intents_cleanup_idx ON chef_photo_upload_intents (cleanup_after);