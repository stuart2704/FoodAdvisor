import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const restaurantsTable = pgTable(
  "restaurants",
  {
    // Google Place ID remains the canonical primary key.
    placeId: text("place_id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    rating: real("rating"),
    website: text("website"),
    websiteTitle: text("website_title"),
    websiteDescription: text("website_description"),
    googleMapsUrl: text("google_maps_url").notNull(),
    types: text("types").array().notNull().default([]),
    cuisineTags: text("cuisine_tags").array().notNull().default([]),
    dietaryTags: text("dietary_tags").array().notNull().default([]),
    enrichedAt: timestamp("enriched_at", { withTimezone: true }),
    enrichmentStatus: text("enrichment_status").notNull().default("pending"),
    enrichmentFailure: text("enrichment_failure"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publicBusinessEmail: text("public_business_email"),
    emailSourceUrl: text("email_source_url"),
    emailDiscoveredAt: timestamp("email_discovered_at", {
      withTimezone: true,
    }),
    outreachStatus: text("outreach_status").notNull().default("pending"),
    outreachFailure: text("outreach_failure"),
    outreachCount: integer("outreach_count").notNull().default(0),
    lastOutreachAt: timestamp("last_outreach_at", { withTimezone: true }),
    nextOutreachAfter: timestamp("next_outreach_after", { withTimezone: true }),
    unsubscribeTokenHash: text("unsubscribe_token_hash"),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    suppressionReason: text("suppression_reason"),
    claimEmail: text("claim_email"),
    claimStatus: text("claim_status"),
    claimAttemptId: text("claim_attempt_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
  },
  (table) => [
    uniqueIndex("restaurants_unsubscribe_token_hash_unique").on(
      table.unsubscribeTokenHash,
    ),
  ],
);

export const restaurantImportRunsTable = pgTable("restaurant_import_runs", {
  id: serial("id").primaryKey(),
  cities: text("cities").array().notNull(),
  requested: integer("requested").notNull(),
  imported: integer("imported").notNull(),
  skippedDuplicates: integer("skipped_duplicates").notNull(),
  apiCalls: integer("api_calls").notNull(),
  estimatedCostCents: integer("estimated_cost_cents").notNull(),
  monthlyBudgetCents: integer("monthly_budget_cents").notNull(),
  stoppedBecause: text("stopped_because").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const outreachAuditTable = pgTable("outreach_audit", {
  id: serial("id").primaryKey(),
  placeId: text("place_id")
    .notNull()
    .references(() => restaurantsTable.placeId),
  event: text("event").notNull(),
  recipientDomain: text("recipient_domain"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Created only after Gmail acknowledges an outreach send. The primary key makes
// the Gmail thread -> restaurant relationship immutable and unambiguous.
export const gmailOutreachThreadsTable = pgTable("gmail_outreach_threads", {
  threadId: text("thread_id").primaryKey(),
  sentMessageId: text("sent_message_id").notNull().unique(),
  placeId: text("place_id")
    .notNull()
    .references(() => restaurantsTable.placeId),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processedGmailMessagesTable = pgTable(
  "processed_gmail_messages",
  {
    messageId: text("message_id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => gmailOutreachThreadsTable.threadId),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// One row per managed Gmail connector account. Gmail history IDs are opaque
// unsigned 64-bit decimal values and therefore must never be stored as numbers.
export const gmailWatchStateTable = pgTable("gmail_watch_state", {
  accountEmail: text("account_email").primaryKey(),
  lastHistoryId: text("last_history_id").notNull(),
  watchExpiration: timestamp("watch_expiration", { withTimezone: true }).notNull(),
  topicName: text("topic_name").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  historyScanStartId: text("history_scan_start_id"),
  historyPageToken: text("history_page_token"),
});

// Durable, body-free inbox history staging. Rows are advanced independently
// from the Gmail cursor so a large history window cannot wedge delivery.
export const gmailHistoryMessagesTable = pgTable("gmail_history_messages", {
  messageId: text("message_id").primaryKey(),
  accountEmail: text("account_email").notNull(),
  threadId: text("thread_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
});

export const insertRestaurantSchema = createInsertSchema(restaurantsTable);
export const insertRestaurantImportRunSchema = createInsertSchema(
  restaurantImportRunsTable,
).omit({ id: true, createdAt: true });

export type RestaurantRecord = typeof restaurantsTable.$inferSelect;
export type InsertRestaurant = typeof restaurantsTable.$inferInsert;
export type RestaurantImportRun =
  typeof restaurantImportRunsTable.$inferSelect;
export type OutreachAudit = typeof outreachAuditTable.$inferSelect;