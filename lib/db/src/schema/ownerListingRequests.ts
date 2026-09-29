import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const ownerListingRequestsTable = pgTable("owner_listing_requests", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  restaurantName: text("restaurant_name").notNull(),
  city: text("city").notNull(),
  address: text("address").notNull(),
  contactName: text("contact_name").notNull(),
  businessEmail: text("business_email").notNull(),
  website: text("website"),
  note: text("note"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});