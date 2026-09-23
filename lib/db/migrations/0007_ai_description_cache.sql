CREATE TABLE IF NOT EXISTS "ai_description_cache" (
  "cache_key" text PRIMARY KEY NOT NULL,
  "restaurant_id" text NOT NULL,
  "description" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_description_cache_restaurant_id_idx"
  ON "ai_description_cache" ("restaurant_id");

CREATE INDEX IF NOT EXISTS "ai_description_cache_expires_at_idx"
  ON "ai_description_cache" ("expires_at");