import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { restaurantsTable } from "./restaurants";

/**
 * One row per UTC month. Reservations are moved to consumed (or released)
 * when a provider request terminates. Keeping both values makes the cap safe
 * while requests are in flight.
 */
export const betterContactBudgetsTable = pgTable("better_contact_budgets", {
  period: text("period").primaryKey(),
  creditCap: integer("credit_cap").notNull(),
  reservedCredits: integer("reserved_credits").notNull().default(0),
  consumedCredits: integer("consumed_credits").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const betterContactJobsTable = pgTable(
  "better_contact_jobs",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    contextHash: text("context_hash").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    company: text("company").notNull(),
    companyDomain: text("company_domain").notNull(),
    personSource: text("person_source").notNull(),
    budgetPeriod: text("budget_period").notNull(),
    reservedCredits: integer("reserved_credits").notNull(),
    // Null on pre-reconciliation rows; legacy timed_out rows were provisionally
    // counted as consumed, while new rows keep their reservation until evidence.
    accountingState: text("accounting_state"),
    status: text("status").notNull(),
    providerRequestId: text("provider_request_id"),
    pollAttempts: integer("poll_attempts").notNull().default(0),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    postStartedAt: timestamp("post_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("better_contact_job_context_unique").on(table.placeId, table.contextHash),
    uniqueIndex("better_contact_job_provider_unique").on(table.providerRequestId),
    index("better_contact_job_poll_idx").on(table.status, table.nextPollAt),
  ],
);

/** Personal results are deliberately isolated from the public restaurant row. */
export const betterContactPrivateContactsTable = pgTable(
  "better_contact_private_contacts",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => betterContactJobsTable.id, { onDelete: "cascade" }),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    providerEmailStatus: text("provider_email_status").notNull(),
    reviewOnly: boolean("review_only").notNull().default(true),
    outreachEligible: boolean("outreach_eligible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("better_contact_private_job_unique").on(table.jobId)],
);

export const betterContactAuditTable = pgTable(
  "better_contact_audit",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").references(() => betterContactJobsTable.id, {
      onDelete: "set null",
    }),
    placeId: text("place_id")
      .notNull()
      .references(() => restaurantsTable.placeId, { onDelete: "cascade" }),
    event: text("event").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("better_contact_audit_job_idx").on(table.jobId, table.createdAt)],
);