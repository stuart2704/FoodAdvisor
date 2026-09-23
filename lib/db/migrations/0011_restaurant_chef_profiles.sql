CREATE TABLE IF NOT EXISTS "restaurant_chef_profiles" (
  "restaurant_id" text PRIMARY KEY NOT NULL REFERENCES "restaurants"("place_id") ON DELETE cascade,
  "name" text,
  "bio" text,
  "philosophy" text,
  "awards" text[] NOT NULL DEFAULT '{}',
  "award_evidence_urls" text[] NOT NULL DEFAULT '{}',
  "signature_dishes" text[] NOT NULL DEFAULT '{}',
  "dish_evidence_urls" text[] NOT NULL DEFAULT '{}',
  "photo_object_path" text,
  "photo_mime_type" text,
  "photo_size_bytes" integer,
  "moderation_status" text NOT NULL DEFAULT 'pending',
  "verified_at" timestamp with time zone,
  "reviewed_by" text,
  "rejection_reason" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "restaurant_chef_profiles_status_idx"
  ON "restaurant_chef_profiles" ("moderation_status");