import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const placePhotoLookupCacheTable = pgTable("place_photo_lookup_cache", {
  cacheKey: text("cache_key").primaryKey(),
  kind: text("kind").notNull(),
  value: jsonb("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("place_photo_lookup_cache_kind_check", sql`${table.kind} IN ('details', 'media')`),
  index("place_photo_lookup_cache_expiry_idx").on(table.expiresAt),
]);