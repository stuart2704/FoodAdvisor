CREATE TABLE IF NOT EXISTS "restaurant_collections" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "city" text NOT NULL,
  "curator_user_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "restaurant_collection_members" (
  "id" text PRIMARY KEY NOT NULL,
  "collection_id" text NOT NULL REFERENCES "restaurant_collections"("id") ON DELETE cascade,
  "restaurant_id" text NOT NULL REFERENCES "restaurants"("place_id") ON DELETE cascade,
  "position" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "restaurant_collections_city_idx"
  ON "restaurant_collections" ("city");
CREATE INDEX IF NOT EXISTS "restaurant_collections_curator_idx"
  ON "restaurant_collections" ("curator_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_collection_member_unique"
  ON "restaurant_collection_members" ("collection_id", "restaurant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_collection_position_unique"
  ON "restaurant_collection_members" ("collection_id", "position");
CREATE INDEX IF NOT EXISTS "restaurant_collection_members_collection_idx"
  ON "restaurant_collection_members" ("collection_id");