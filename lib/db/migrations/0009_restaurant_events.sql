CREATE TABLE IF NOT EXISTS "restaurant_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "event_date" date NOT NULL,
  "event_time" text NOT NULL,
  "price" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restaurant_events_restaurant_id_restaurants_place_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("place_id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "restaurant_events_time_check"
    CHECK ("event_time" ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
);

CREATE INDEX IF NOT EXISTS "restaurant_events_restaurant_date_time_idx"
  ON "restaurant_events" USING btree ("restaurant_id", "event_date", "event_time");