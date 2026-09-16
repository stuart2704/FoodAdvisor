import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const aiUsageEventsTable = pgTable("ai_usage_events", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull(),
  totalTokens: integer("total_tokens").notNull(),
  estimatedCostMicros: integer("estimated_cost_micros").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AiUsageEvent = typeof aiUsageEventsTable.$inferSelect;
export type InsertAiUsageEvent = typeof aiUsageEventsTable.$inferInsert;