import {
  boolean,
  date,
  doublePrecision,
  integer,
  index,
  jsonb,
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
    region: text("region"),
    country: text("country"),
    globalRegion: text("global_region"),
    slug: text("slug"),
    // Coordinates are optional because older imports and manually added
    // listings may not have a verified Places location yet.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    rating: real("rating"),
    priceLevel: text("price_level"),
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
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"),
    ownerPhone: text("owner_phone"),
    brandStyle: text("brand_style"),
    openingHours: text("opening_hours").array().notNull().default([]),
    deliveryPlatforms: text("delivery_platforms").array().notNull().default([]),
    socialLinks: jsonb("social_links")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    claimStatus: text("claim_status"),
    claimAttemptId: text("claim_attempt_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    qualificationScore: integer("qualification_score"),
    qualificationTier: text("qualification_tier"),
    qualificationReason: text("qualification_reason"),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    popularity: real("popularity").notNull().default(0),
    aiRelevanceBoost: real("ai_relevance_boost"),
    rankingScore: real("ranking_score").notNull().default(0),
    rankingUpdatedAt: timestamp("ranking_updated_at", { withTimezone: true }),
    leadStatus: text("lead_status"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    claimClickedAt: timestamp("claim_clicked_at", { withTimezone: true }),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    onboardingStatus: text("onboarding_status"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    premium: boolean("premium").notNull().default(false),
    premiumSince: timestamp("premium_since", { withTimezone: true }),
    premiumCancelledAt: timestamp("premium_cancelled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("restaurants_slug_unique").on(table.slug),
    uniqueIndex("restaurants_unsubscribe_token_hash_unique").on(
      table.unsubscribeTokenHash,
    ),
  ],
);

export const stripeProcessedEventsTable = pgTable("stripe_processed_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurantSearchEventsTable = pgTable("restaurant_search_events", {
  id: serial("id").primaryKey(),
  queryProvided: boolean("query_provided").notNull(),
  cityFiltered: boolean("city_filtered").notNull(),
  cuisineFiltered: boolean("cuisine_filtered").notNull(),
  premiumOnly: boolean("premium_only").notNull(),
  aiRequested: boolean("ai_requested").notNull(),
  aiScoredCount: integer("ai_scored_count").notNull().default(0),
  resultCount: integer("result_count").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const homepageViewEventsTable = pgTable("homepage_view_events", {
  id: serial("id").primaryKey(),
  featuredCount: integer("featured_count").notNull(),
  trendingCount: integer("trending_count").notNull(),
  premiumCount: integer("premium_count").notNull(),
  discoveryCount: integer("discovery_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cityPageViewEventsTable = pgTable("city_page_view_events", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  restaurantCount: integer("restaurant_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cuisinePageViewEventsTable = pgTable("cuisine_page_view_events", {
  id: serial("id").primaryKey(),
  cuisine: text("cuisine").notNull(),
  restaurantCount: integer("restaurant_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const directoryViewEventsTable = pgTable("directory_view_events", {
  id: serial("id").primaryKey(),
  page: integer("page").notNull(),
  resultCount: integer("result_count").notNull(),
  cityFiltered: boolean("city_filtered").notNull(),
  cuisineFiltered: boolean("cuisine_filtered").notNull(),
  priceFiltered: boolean("price_filtered").notNull(),
  premiumOnly: boolean("premium_only").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const restaurantProfileViewEventsTable = pgTable(
  "restaurant_profile_view_events",
  {
    id: serial("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    premium: boolean("premium").notNull(),
    claimed: boolean("claimed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const claimPageEventsTable = pgTable("claim_page_events", {
  id: serial("id").primaryKey(),
  placeId: text("place_id")
    .notNull()
    .references(() => restaurantsTable.placeId),
  eventType: text("event_type").notNull(),
  alreadyClaimed: boolean("already_claimed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    type: text("type").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("analytics_events_restaurant_type_created_idx").on(
      table.restaurantId,
      table.type,
      table.createdAt,
    ),
  ],
);

export const dailyAnalyticsTable = pgTable("daily_analytics", {
  date: date("date").primaryKey(),
  profileViews: integer("profile_views").notNull().default(0),
  menuViews: integer("menu_views").notNull().default(0),
  photoViews: integer("photo_views").notNull().default(0),
  searchImpressions: integer("search_impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  claimClicks: integer("claim_clicks").notNull().default(0),
  premiumConversions: integer("premium_conversions").notNull().default(0),
});

export const globalMetricsSnapshotsTable = pgTable(
  "global_metrics_snapshots",
  {
    id: serial("id").primaryKey(),
    totalRestaurants: integer("total_restaurants").notNull(),
    totalClients: integer("total_clients").notNull(),
    totalPremiumClients: integer("total_premium_clients").notNull(),
    totalVisits: integer("total_visits").notNull(),
    totalClicks: integer("total_clicks").notNull(),
    totalSearchImpressions: integer("total_search_impressions")
      .notNull()
      .default(0),
    totalClaimConversions: integer("total_claim_conversions")
      .notNull()
      .default(0),
    totalOnboardingCompletions: integer("total_onboarding_completions")
      .notNull()
      .default(0),
    totalPremiumConversions: integer("total_premium_conversions")
      .notNull()
      .default(0),
    funnelOutreach: integer("funnel_outreach").notNull().default(0),
    funnelFollowUp: integer("funnel_follow_up").notNull().default(0),
    funnelEscalation: integer("funnel_escalation").notNull().default(0),
    funnelClaim: integer("funnel_claim").notNull().default(0),
    funnelOnboarding: integer("funnel_onboarding").notNull().default(0),
    funnelPortalLogin: integer("funnel_portal_login").notNull().default(0),
    funnelPremium: integer("funnel_premium").notNull().default(0),
    topCities: jsonb("top_cities")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    topCuisines: jsonb("top_cuisines")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    mrr: integer("mrr").notNull().default(0),
    arr: integer("arr").notNull().default(0),
    churnRate: real("churn_rate").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export interface RecentProfileSearch {
  city?: string;
  cuisine?: string;
  priceLevel?: string;
  searchedAt: string;
}

export const userProfilesTable = pgTable(
  "user_profiles",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    preferredCities: text("preferred_cities").array().notNull().default([]),
    preferredCuisines: text("preferred_cuisines")
      .array()
      .notNull()
      .default([]),
    preferredPriceLevels: text("preferred_price_levels")
      .array()
      .notNull()
      .default([]),
    recentClicks: text("recent_clicks").array().notNull().default([]),
    recentSearches: jsonb("recent_searches")
      .$type<RecentProfileSearch[]>()
      .notNull()
      .default([]),
    lastSeenSections: text("last_seen_sections")
      .array()
      .notNull()
      .default([]),
  },
  (table) => [index("user_profiles_type_idx").on(table.type)],
);

export const visitorProfilesTable = pgTable("visitor_profiles", {
  id: text("id").primaryKey(),
  preferredCities: text("preferred_cities").array().notNull().default([]),
  preferredCuisines: text("preferred_cuisines")
    .array()
    .notNull()
    .default([]),
  preferredPriceLevels: text("preferred_price_levels")
    .array()
    .notNull()
    .default([]),
  recentSearches: jsonb("recent_searches")
    .$type<RecentProfileSearch[]>()
    .notNull()
    .default([]),
  recentClicks: text("recent_clicks").array().notNull().default([]),
  lastSeenSections: text("last_seen_sections")
    .array()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const ownerProfilesTable = pgTable("owner_profiles", {
  restaurantId: text("restaurant_id")
    .primaryKey()
    .references(() => restaurantsTable.placeId),
  mostViewedAnalytics: jsonb("most_viewed_analytics")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  weakAreas: text("weak_areas").array().notNull().default([]),
  strongAreas: text("strong_areas").array().notNull().default([]),
  premiumReadinessScore: integer("premium_readiness_score")
    .notNull()
    .default(0),
  onboardingCompletionScore: integer("onboarding_completion_score")
    .notNull()
    .default(0),
  lastLogin: timestamp("last_login", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const restaurantPortalTokensTable = pgTable(
  "restaurant_portal_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .unique()
      .references(() => restaurantsTable.placeId),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
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

// Instantly identifiers are stored only after this service has created the
// campaign. They are the sole provider-to-restaurant association; subjects,
// custom variables, and lead-provided fields are never used as ownership keys.
// Each campaign contains one lead and one initial-email step so that activating
// it cannot exceed the application's shared daily delivery reservation.
export const instantlyOutreachCampaignsTable = pgTable(
  "instantly_outreach_campaigns",
  {
    campaignId: text("campaign_id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .unique()
      .references(() => restaurantsTable.placeId),
    recipientEmail: text("recipient_email").notNull(),
    eaccount: text("eaccount").notNull(),
    leadId: text("lead_id").unique(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
);

// An immutable provider email id makes polling idempotent. A row is inserted
// before classification so an inbound message remains a reply barrier even
// when its body cannot safely be read.
export const processedInstantlyMessagesTable = pgTable(
  "processed_instantly_messages",
  {
    messageId: text("message_id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => instantlyOutreachCampaignsTable.campaignId),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// The original campaign table has a one-campaign-per-place constraint. Keep it
// as the immutable initial-send mapping and use this append-only table for
// independently capped follow-up campaigns.
export const instantlyFollowupCampaignsTable = pgTable(
  "instantly_followup_campaigns",
  {
    campaignId: text("campaign_id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    emailNumber: integer("email_number").notNull(),
    subject: text("subject"),
    recipientEmail: text("recipient_email").notNull(),
    eaccount: text("eaccount").notNull(),
    leadId: text("lead_id").unique(),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("instantly_followup_campaign_place_step_unique").on(
      table.placeId,
      table.emailNumber,
    ),
  ],
);

export const processedInstantlyFollowupMessagesTable = pgTable(
  "processed_instantly_followup_messages",
  {
    messageId: text("message_id").primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => instantlyFollowupCampaignsTable.campaignId),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// A provider email is accepted as sent only once and records the provider's
// actual send timestamp. This supports safe reconciliation and due-date logic
// without trusting subject lines or campaign variables.
export const instantlySentMessagesTable = pgTable(
  "instantly_sent_messages",
  {
    messageId: text("message_id").primaryKey(),
    campaignId: text("campaign_id").notNull().unique(),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    emailNumber: integer("email_number").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// Resumable cursor for one managed Instantly inbox. Sending refuses to proceed
// unless a complete pagination pass succeeds immediately beforehand.
export const instantlyInboxStateTable = pgTable("instantly_inbox_state", {
  eaccount: text("eaccount").primaryKey(),
  nextStartingAfter: text("next_starting_after"),
  lastFullyReconciledAt: timestamp("last_fully_reconciled_at", {
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Local durable intent to pause a campaign when a claim, opt-out, or negative
// reply wins. Remote cancellation is necessarily non-atomic and is retried by
// the guarded delivery cycle.
export const instantlyCampaignCancellationTable = pgTable(
  "instantly_campaign_cancellations",
  {
    campaignId: text("campaign_id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
);

// One row per managed Gmail connector account. Gmail history IDs are opaque
// unsigned 64-bit decimal values and therefore must never be stored as numbers.
export const gmailWatchStateTable = pgTable("gmail_watch_state", {
  accountEmail: text("account_email").primaryKey(),
  lastHistoryId: text("last_history_id").notNull(),
  watchExpiration: timestamp("watch_expiration", { withTimezone: true }).notNull(),
  lastRenewedAt: timestamp("last_renewed_at", { withTimezone: true }),
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