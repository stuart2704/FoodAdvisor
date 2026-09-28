-- Additive gallery storage; apply to each external database before deploying photo routes.
CREATE TABLE IF NOT EXISTS restaurant_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL REFERENCES restaurants(place_id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  generation text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE restaurant_photos ADD COLUMN IF NOT EXISTS generation text;
ALTER TABLE restaurant_photos ALTER COLUMN generation SET NOT NULL;
CREATE INDEX IF NOT EXISTS restaurant_photos_public_idx ON restaurant_photos (restaurant_id, status);

CREATE TABLE IF NOT EXISTS restaurant_photo_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id text NOT NULL REFERENCES restaurants(place_id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  cleanup_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_photo_intents_cleanup_idx ON restaurant_photo_intents (cleanup_after);

CREATE TABLE IF NOT EXISTS restaurant_photo_deletion_queue (
  object_path text PRIMARY KEY,
  due_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurant_photo_deletion_due_idx ON restaurant_photo_deletion_queue (due_at);