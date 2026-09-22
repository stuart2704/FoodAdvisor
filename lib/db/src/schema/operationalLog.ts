import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const operationalLogEventsTable = pgTable(
  "operational_log_events",
  {
    id: text("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    category: text("category"),
    bookmarked: boolean("bookmarked").notNull().default(false),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
  },
  (table) => [
    index("operational_log_events_created_at_idx").on(table.createdAt),
    index("operational_log_events_type_created_at_idx").on(
      table.type,
      table.createdAt,
    ),
  ],
);

export type OperationalLogEvent =
  typeof operationalLogEventsTable.$inferSelect;
export type InsertOperationalLogEvent =
  typeof operationalLogEventsTable.$inferInsert;