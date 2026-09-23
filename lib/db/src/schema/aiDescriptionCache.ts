import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const aiDescriptionCacheTable = pgTable(
  "ai_description_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    restaurantId: text("restaurant_id").notNull(),
    description: text("description"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_description_cache_restaurant_id_idx").on(table.restaurantId),
    index("ai_description_cache_expires_at_idx").on(table.expiresAt),
  ],
);

export type AiDescriptionCacheEntry =
  typeof aiDescriptionCacheTable.$inferSelect;
export type InsertAiDescriptionCacheEntry =
  typeof aiDescriptionCacheTable.$inferInsert;