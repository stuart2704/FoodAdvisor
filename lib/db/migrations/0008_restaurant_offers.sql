CREATE TABLE IF NOT EXISTS "restaurant_offers" (
  "id" serial PRIMARY KEY NOT NULL,
  "restaurant_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "restaurant_offers_restaurant_id_restaurants_place_id_fk"
    FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("place_id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "restaurant_offers_date_range_check"
    CHECK ("start_date" <= "end_date")
);

CREATE INDEX IF NOT EXISTS "restaurant_offers_restaurant_dates_idx"
  ON "restaurant_offers" USING btree ("restaurant_id", "start_date", "end_date");