import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const engineHeartbeatsTable = pgTable("engine_heartbeats", {
  engine: text("engine").primaryKey(),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EngineHeartbeat = typeof engineHeartbeatsTable.$inferSelect;