import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const chefPhotoDeletionQueueTable = pgTable(
  "chef_photo_deletion_queue",
  {
    objectPath: text("object_path").primaryKey(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("chef_photo_deletion_queue_due_idx").on(table.dueAt)],
);