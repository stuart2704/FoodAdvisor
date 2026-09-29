import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const stripeCheckoutAlertsTable = pgTable("stripe_checkout_alerts", {
  sessionId: text("session_id").primaryKey(),
  restaurantId: text("restaurant_id").notNull(),
  customerId: text("customer_id").notNull(),
  subscriptionId: text("subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidObservedAt: timestamp("paid_observed_at", { withTimezone: true }),
  alertedAt: timestamp("alerted_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("stripe_checkout_alerts_unresolved_idx").on(table.resolvedAt, table.createdAt),
]);