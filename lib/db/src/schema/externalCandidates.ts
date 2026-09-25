import {
  doublePrecision,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const externalCandidatesTable = pgTable(
  "external_candidates",
  {
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    rawName: text("raw_name").notNull(),
    rawAddress: text("raw_address"),
    rawLat: doublePrecision("raw_lat"),
    rawLon: doublePrecision("raw_lon"),
    rawPhone: text("raw_phone"),
    rawWebsite: text("raw_website"),
    sourceFlags: text("source_flags").array().notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    verificationStatus: text("verification_status").notNull().default("unverified"),
  },
  (table) => [primaryKey({ columns: [table.sourceName, table.sourceId] })],
);

export const insertExternalCandidateSchema = createInsertSchema(externalCandidatesTable);
export type InsertExternalCandidate = typeof externalCandidatesTable.$inferInsert;
export type StoredExternalCandidate = typeof externalCandidatesTable.$inferSelect;