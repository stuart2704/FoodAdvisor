import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const externalIngestionLeaseTable = pgTable("external_ingestion_lease", {
  id: text("id").primaryKey(),
  ownerToken: text("owner_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});