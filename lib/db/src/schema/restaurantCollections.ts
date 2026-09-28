import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { restaurantsTable } from "./restaurants";

export const restaurantCollectionsTable = pgTable(
  "restaurant_collections",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    city: text("city").notNull(),
    curatorUserId: text("curator_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("restaurant_collections_city_idx").on(table.city),
    index("restaurant_collections_curator_idx").on(table.curatorUserId),
  ],
);

export const restaurantCollectionMembersTable = pgTable(
  "restaurant_collection_members",
  {
    id: text("id").notNull(),
    collectionId: text("collection_id")
      .notNull()
      .references(() => restaurantCollectionsTable.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    uniqueIndex("restaurant_collection_member_unique").on(
      table.collectionId,
      table.restaurantId,
    ),
    uniqueIndex("restaurant_collection_position_unique").on(
      table.collectionId,
      table.position,
    ),
    index("restaurant_collection_members_collection_idx").on(table.collectionId),
  ],
);

export const insertRestaurantCollectionSchema = createInsertSchema(
  restaurantCollectionsTable,
).omit({ createdAt: true, updatedAt: true, version: true });

export const insertRestaurantCollectionMemberSchema = createInsertSchema(
  restaurantCollectionMembersTable,
);

export type RestaurantCollection =
  typeof restaurantCollectionsTable.$inferSelect;
export type InsertRestaurantCollection =
  typeof restaurantCollectionsTable.$inferInsert;
export type RestaurantCollectionMember =
  typeof restaurantCollectionMembersTable.$inferSelect;