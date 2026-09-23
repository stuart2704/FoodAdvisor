CREATE TABLE IF NOT EXISTS "chef_photo_upload_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "object_path" text NOT NULL UNIQUE,
  "restaurant_id" text NOT NULL REFERENCES "restaurants"("place_id") ON DELETE cascade,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "chef_photo_upload_intents_owner_active_idx"
  ON "chef_photo_upload_intents" ("restaurant_id", "expires_at", "consumed_at");
CREATE INDEX IF NOT EXISTS "chef_photo_upload_intents_expires_idx"
  ON "chef_photo_upload_intents" ("expires_at");