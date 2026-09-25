import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { externalCandidatesTable } from "./externalCandidates";

export type OsmOwnerDraftData = {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
  openingHours: string[];
  latitude: number | null;
  longitude: number | null;
};

export type OsmActivationError = {
  step: string;
  errorCode: string;
  timestamp: string;
};

export const osmCandidateWorkflowsTable = pgTable(
  "osm_candidate_workflows",
  {
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    state: text("state").notNull().default("unverified"),
    reviewed: boolean("reviewed").notNull().default(false),
    claimed: boolean("claimed").notNull().default(false),
    identityVerified: boolean("identity_verified").notNull().default(false),
    rightsConfirmed: boolean("rights_confirmed").notNull().default(false),
    published: boolean("published").notNull().default(false),
    suppressed: boolean("suppressed").notNull().default(false),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    suppressedReason: text("suppressed_reason"),
    suppressedBy: text("suppressed_by"),
    outreachBlocked: boolean("outreach_blocked").notNull().default(false),
    highConfidence: boolean("high_confidence").notNull().default(false),
    inviteCount: integer("invite_count").notNull().default(0),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ownerDraft: jsonb("owner_draft")
      .$type<OsmOwnerDraftData>()
      .notNull(),
    ownerOutreachDisabled: boolean("owner_outreach_disabled")
      .notNull()
      .default(false),
    restaurantPlaceId: text("restaurant_place_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceName, table.sourceId] }),
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        externalCandidatesTable.sourceName,
        externalCandidatesTable.sourceId,
      ],
      name: "osm_candidate_workflows_external_candidate_fk",
    }).onDelete("cascade"),
    index("osm_candidate_workflows_state_idx").on(table.state, table.updatedAt),
    uniqueIndex("osm_candidate_workflows_restaurant_unique").on(
      table.restaurantPlaceId,
    ),
  ],
);

export const osmClaimInvitesTable = pgTable(
  "osm_claim_invites",
  {
    id: serial("id").primaryKey(),
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    sentTo: text("sent_to").notNull(),
    method: text("method").notNull(),
    status: text("status").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    providerSentAt: timestamp("provider_sent_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        osmCandidateWorkflowsTable.sourceName,
        osmCandidateWorkflowsTable.sourceId,
      ],
      name: "osm_claim_invites_workflow_fk",
    }).onDelete("cascade"),
    index("osm_claim_invites_candidate_created_idx").on(
      table.sourceName,
      table.sourceId,
      table.createdAt,
    ),
    index("osm_claim_invites_candidate_sent_idx").on(
      table.sourceName,
      table.sourceId,
      table.providerSentAt,
    ),
  ],
);

export const osmOwnerSessionsTable = pgTable(
  "osm_owner_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        osmCandidateWorkflowsTable.sourceName,
        osmCandidateWorkflowsTable.sourceId,
      ],
      name: "osm_owner_sessions_workflow_fk",
    }).onDelete("cascade"),
    index("osm_owner_sessions_candidate_idx").on(
      table.sourceName,
      table.sourceId,
      table.expiresAt,
    ),
  ],
);

export const osmVerificationCodesTable = pgTable(
  "osm_verification_codes",
  {
    id: serial("id").primaryKey(),
    ownerSessionHash: text("owner_session_hash")
      .notNull()
      .references(() => osmOwnerSessionsTable.tokenHash, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    index("osm_verification_codes_session_created_idx").on(
      table.ownerSessionHash,
      table.createdAt,
    ),
  ],
);

export const osmCandidateEvidenceTable = pgTable(
  "osm_candidate_evidence",
  {
    id: serial("id").primaryKey(),
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    evidenceUrl: text("evidence_url"),
    sourceAttribution: text("source_attribution"),
    status: text("status").notNull().default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    reviewerNote: text("reviewer_note"),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        osmCandidateWorkflowsTable.sourceName,
        osmCandidateWorkflowsTable.sourceId,
      ],
      name: "osm_candidate_evidence_workflow_fk",
    }).onDelete("cascade"),
    uniqueIndex("osm_candidate_evidence_candidate_kind_unique").on(
      table.sourceName,
      table.sourceId,
      table.kind,
    ),
    index("osm_candidate_evidence_status_idx").on(
      table.status,
      table.submittedAt,
    ),
  ],
);

export const osmOutreachLogsTable = pgTable(
  "osm_outreach_logs",
  {
    id: serial("id").primaryKey(),
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    inviteId: integer("invite_id").references(() => osmClaimInvitesTable.id, {
      onDelete: "set null",
    }),
    sentTo: text("sent_to"),
    method: text("method").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        osmCandidateWorkflowsTable.sourceName,
        osmCandidateWorkflowsTable.sourceId,
      ],
      name: "osm_outreach_logs_workflow_fk",
    }).onDelete("cascade"),
    index("osm_outreach_logs_candidate_created_idx").on(
      table.sourceName,
      table.sourceId,
      table.createdAt,
    ),
  ],
);

export const osmActivationStatesTable = pgTable(
  "osm_activation_states",
  {
    sourceName: text("source_name").notNull(),
    sourceId: text("source_id").notNull(),
    promoted: boolean("promoted").notNull().default(false),
    enriched: boolean("enriched").notNull().default(false),
    scored: boolean("scored").notNull().default(false),
    published: boolean("published").notNull().default(false),
    currentStep: text("current_step"),
    errors: jsonb("errors").$type<OsmActivationError[]>().notNull().default([]),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceName, table.sourceId] }),
    foreignKey({
      columns: [table.sourceName, table.sourceId],
      foreignColumns: [
        osmCandidateWorkflowsTable.sourceName,
        osmCandidateWorkflowsTable.sourceId,
      ],
      name: "osm_activation_states_workflow_fk",
    }).onDelete("cascade"),
  ],
);

export const insertOsmCandidateWorkflowSchema = createInsertSchema(
  osmCandidateWorkflowsTable,
);
export const insertOsmClaimInviteSchema = createInsertSchema(osmClaimInvitesTable);
export const insertOsmCandidateEvidenceSchema = createInsertSchema(
  osmCandidateEvidenceTable,
);
export const insertOsmOutreachLogSchema = createInsertSchema(osmOutreachLogsTable);
export const insertOsmActivationStateSchema = createInsertSchema(
  osmActivationStatesTable,
);

export type OsmCandidateWorkflow = typeof osmCandidateWorkflowsTable.$inferSelect;
export type OsmClaimInvite = typeof osmClaimInvitesTable.$inferSelect;
export type OsmOwnerSession = typeof osmOwnerSessionsTable.$inferSelect;
export type OsmVerificationCode = typeof osmVerificationCodesTable.$inferSelect;
export type OsmCandidateEvidence = typeof osmCandidateEvidenceTable.$inferSelect;
export type OsmOutreachLog = typeof osmOutreachLogsTable.$inferSelect;
export type OsmActivationState = typeof osmActivationStatesTable.$inferSelect;