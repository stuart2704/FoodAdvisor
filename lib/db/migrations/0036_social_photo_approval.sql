ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_object_path TEXT;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_approved_at TIMESTAMPTZ;