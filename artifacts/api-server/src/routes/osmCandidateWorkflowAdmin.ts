import {
  db,
  externalCandidatesTable,
  osmActivationStatesTable,
  osmCandidateEvidenceTable,
  osmCandidateWorkflowsTable,
  osmClaimInvitesTable,
  osmOwnerSessionsTable,
  osmOutreachLogsTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";
import {
  OSM_SOURCE,
  autoInviteEligibility,
  isCurrentEvidenceSubmission,
  requiredFieldsComplete,
} from "../services/osmCandidateWorkflow";
import { sendOsmInvite } from "../services/osmInviteDelivery";

const router: IRouter = Router();
const candidateParams = z.object({
  sourceName: z.literal(OSM_SOURCE),
  sourceId: z.string().trim().min(1).max(512),
});

function evidenceStatus(value: string | undefined): "not_submitted" | "pending" | "approved" | "rejected" {
  if (value === "pending" || value === "approved" || value === "rejected") return value;
  return "not_submitted";
}

function evidenceSubmission(value: typeof osmCandidateEvidenceTable.$inferSelect | undefined) {
  if (!value) return null;
  return {
    status: evidenceStatus(value.status),
    description: value.description,
    evidenceUrl: value.evidenceUrl,
    sourceAttribution: value.sourceAttribution,
    submittedAt: value.submittedAt.toISOString(),
    reviewedAt: value.reviewedAt?.toISOString() ?? null,
    reviewedBy: value.reviewedBy,
    reviewerNote: value.reviewerNote,
  };
}

function progress(value: typeof osmActivationStatesTable.$inferSelect | undefined) {
  return {
    promoted: value?.promoted ?? false,
    enriched: value?.enriched ?? false,
    scored: value?.scored ?? false,
    published: value?.published ?? false,
    currentStep: value?.currentStep ?? null,
    errors: value?.errors ?? [],
    activatedAt: value?.activatedAt?.toISOString() ?? null,
  };
}

async function getWorkflow(sourceId: string) {
  const [candidate] = await db
    .select()
    .from(externalCandidatesTable)
    .where(and(
      eq(externalCandidatesTable.sourceName, OSM_SOURCE),
      eq(externalCandidatesTable.sourceId, sourceId),
    ))
    .limit(1);
  if (!candidate) return null;
  const [workflow] = await db
    .select()
    .from(osmCandidateWorkflowsTable)
    .where(and(
      eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
      eq(osmCandidateWorkflowsTable.sourceId, sourceId),
    ))
    .limit(1);
  if (!workflow) return null;
  const [evidenceRows, activationRows, inviteRows] = await Promise.all([
    db.select().from(osmCandidateEvidenceTable).where(and(
      eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
      eq(osmCandidateEvidenceTable.sourceId, sourceId),
    )),
    db.select().from(osmActivationStatesTable).where(and(
      eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
      eq(osmActivationStatesTable.sourceId, sourceId),
    )).limit(1),
    db.select({ status: osmClaimInvitesTable.status, createdAt: osmClaimInvitesTable.createdAt })
      .from(osmClaimInvitesTable).where(and(
        eq(osmClaimInvitesTable.sourceName, OSM_SOURCE),
        eq(osmClaimInvitesTable.sourceId, sourceId),
      )).orderBy(desc(osmClaimInvitesTable.createdAt), desc(osmClaimInvitesTable.id)).limit(1),
  ]);
  const ownership = evidenceRows.find((item) => item.kind === "ownership");
  const rights = evidenceRows.find((item) => item.kind === "source_rights");
  const activation = activationRows[0];
  const autoInvite = autoInviteEligibility(workflow, inviteRows[0], new Date());
  return {
    candidate: {
      sourceName: OSM_SOURCE,
      sourceId: candidate.sourceId,
      name: candidate.rawName,
      address: candidate.rawAddress,
      phone: candidate.rawPhone,
      website: candidate.rawWebsite,
      latitude: candidate.rawLat,
      longitude: candidate.rawLon,
      importedAt: candidate.importedAt.toISOString(),
      reviewedAt: workflow.reviewedAt?.toISOString() ?? null,
      state: workflow.state,
      reviewed: workflow.reviewed,
      claimed: workflow.claimed,
      identityVerified: workflow.identityVerified,
      rightsConfirmed: workflow.rightsConfirmed,
      published: workflow.published,
      suppressed: workflow.suppressed,
      outreachBlocked: workflow.outreachBlocked,
      highConfidence: workflow.highConfidence,
      inviteCount: workflow.inviteCount,
      autoInviteEnabled: workflow.autoInviteEnabled,
      approvedContactEmail: workflow.approvedContactEmail,
      contactEvidence: workflow.contactEvidence,
      contactApprovedAt: workflow.contactApprovedAt?.toISOString() ?? null,
      autoInviteStatus: autoInvite.status,
      autoInviteDueAt: autoInvite.dueAt?.toISOString() ?? null,
      requiredFieldsComplete: requiredFieldsComplete(workflow.ownerDraft),
    },
    evidence: {
      ownershipStatus: evidenceStatus(ownership?.status),
      rightsStatus: evidenceStatus(rights?.status),
      submittedAt: [ownership?.submittedAt, rights?.submittedAt]
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
      ownershipSubmission: evidenceSubmission(ownership),
      sourceRightsSubmission: evidenceSubmission(rights),
    },
    activation: progress(activation),
    workflow,
  };
}

router.get("/dashboard/osm-candidates", adminOnly, async (req, res) => {
  const query = z.object({
    state: z.enum([
      "unverified",
      "reviewed",
      "claim_invited",
      "claim_verified",
      "activated",
      "published",
      "suppressed",
    ]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(1024).optional(),
  }).safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid candidate queue parameters." });
    return;
  }
  try {
    let cursorId: string | undefined;
    if (query.data.cursor) {
      try {
        cursorId = Buffer.from(query.data.cursor, "base64url").toString("utf8");
        if (!cursorId || cursorId.length > 512) throw new Error("invalid cursor");
      } catch {
        res.status(400).json({ error: "Invalid candidate cursor." });
        return;
      }
    }
    const conditions = [
      eq(externalCandidatesTable.sourceName, OSM_SOURCE),
      ...(cursorId ? [gt(externalCandidatesTable.sourceId, cursorId)] : []),
      ...(query.data.state ? [eq(osmCandidateWorkflowsTable.state, query.data.state)] : []),
    ];
    const rows = await db
      .select({
        sourceId: externalCandidatesTable.sourceId,
      })
      .from(externalCandidatesTable)
      .innerJoin(
        osmCandidateWorkflowsTable,
        and(
          eq(externalCandidatesTable.sourceName, osmCandidateWorkflowsTable.sourceName),
          eq(externalCandidatesTable.sourceId, osmCandidateWorkflowsTable.sourceId),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(externalCandidatesTable.sourceId))
      .limit(query.data.limit + 1);
    const hasMore = rows.length > query.data.limit;
    const pageIds = rows.slice(0, query.data.limit).map((row) => row.sourceId);
    const items = await Promise.all(pageIds.map((sourceId) => getWorkflow(sourceId)));
    res.setHeader("Cache-Control", "no-store");
    res.json({
      items: items.filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map(({ workflow: _workflow, ...response }) => response),
      nextCursor: hasMore && pageIds.length
        ? Buffer.from(pageIds[pageIds.length - 1], "utf8").toString("base64url")
        : null,
    });
  } catch (error) {
    req.log.error({ err: error }, "OSM candidate queue read failed");
    res.status(503).json({ error: "Candidate queue is unavailable." });
  }
});

router.get("/dashboard/osm-candidates/:sourceName/:sourceId", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid candidate identity." });
    return;
  }
  try {
    const result = await getWorkflow(params.data.sourceId);
    if (!result) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow: _workflow, ...response } = result;
    res.setHeader("Cache-Control", "no-store");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM candidate detail read failed");
    res.status(503).json({ error: "Candidate details are unavailable." });
  }
});

router.post("/dashboard/osm-candidates/:sourceName/:sourceId/review", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid candidate identity." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${params.data.sourceId}))`);
      const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      )).limit(1);
      if (!current) return "missing" as const;
      if (current.suppressed || current.published) return "conflict" as const;
      if (current.reviewed) return "success" as const;
      const now = new Date();
      const [changed] = await tx.update(osmCandidateWorkflowsTable).set({
        reviewed: true,
        reviewedAt: now,
        state: "reviewed",
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
        eq(osmCandidateWorkflowsTable.suppressed, false),
        eq(osmCandidateWorkflowsTable.published, false),
      )).returning({ sourceId: osmCandidateWorkflowsTable.sourceId });
      if (!changed) return "conflict" as const;
      await tx.update(externalCandidatesTable).set({ verificationStatus: "verified" }).where(and(
        eq(externalCandidatesTable.sourceName, OSM_SOURCE),
        eq(externalCandidatesTable.sourceId, params.data.sourceId),
        inArray(externalCandidatesTable.verificationStatus, ["unverified", "review_ready"]),
      ));
      return "success" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (result === "conflict") {
      res.status(409).json({ error: "Candidate cannot transition to reviewed." });
      return;
    }
    const details = await getWorkflow(params.data.sourceId);
    if (!details) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow: _workflow, ...response } = details;
    res.setHeader("Cache-Control", "no-store, private");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM candidate review failed");
    res.status(503).json({ error: "Candidate review is unavailable." });
  }
});

const suppressionInput = z.object({
  reason: z.string().max(1000).optional(),
}).strict();

router.post("/dashboard/osm-candidates/:sourceName/:sourceId/reject", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  const body = suppressionInput.safeParse(req.body ?? {});
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid suppression request." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${params.data.sourceId}))`);
      const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      )).limit(1);
      if (!current) return "missing" as const;
      if (current.published) return "published" as const;
      const now = new Date();
      await tx.update(osmCandidateWorkflowsTable).set({
        state: "suppressed",
        suppressed: true,
        suppressedAt: now,
        suppressedReason: body.data.reason?.trim() || null,
        suppressedBy: "admin_session",
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
        eq(osmCandidateWorkflowsTable.published, false),
      ));
      await tx.update(osmClaimInvitesTable).set({ revokedAt: now, status: "revoked" }).where(and(
        eq(osmClaimInvitesTable.sourceName, OSM_SOURCE),
        eq(osmClaimInvitesTable.sourceId, params.data.sourceId),
        isNull(osmClaimInvitesTable.usedAt),
        isNull(osmClaimInvitesTable.revokedAt),
      ));
      await tx.update(osmOwnerSessionsTable).set({ revokedAt: now }).where(and(
        eq(osmOwnerSessionsTable.sourceName, OSM_SOURCE),
        eq(osmOwnerSessionsTable.sourceId, params.data.sourceId),
        isNull(osmOwnerSessionsTable.revokedAt),
      ));
      await tx.update(externalCandidatesTable).set({ verificationStatus: "rejected" }).where(and(
        eq(externalCandidatesTable.sourceName, OSM_SOURCE),
        eq(externalCandidatesTable.sourceId, params.data.sourceId),
      ));
      return "success" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (result === "published") {
      res.status(409).json({ error: "Published candidates cannot be suppressed by this action." });
      return;
    }
    const details = await getWorkflow(params.data.sourceId);
    if (!details) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow: _workflow, ...response } = details;
    res.setHeader("Cache-Control", "no-store, private");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM candidate suppression failed");
    res.status(503).json({ error: "Candidate suppression is unavailable." });
  }
});

const inviteInput = z.object({
  sentTo: z.string().trim().min(1).max(254),
  method: z.enum(["email", "sms", "outreach"]),
}).strict();

async function deliverInvite(
  req: Parameters<Parameters<IRouter["post"]>[1]>[0],
  res: Parameters<Parameters<IRouter["post"]>[1]>[1],
  sourceId: string,
  requested: { sentTo?: string; method?: "email" | "sms" | "outreach" },
) {
  if (requested.method && requested.method !== "email") {
    res.status(503).json({ error: requested.method === "sms"
      ? "SMS sending is unavailable because no verified sender is configured."
      : "Instantly outreach cannot send OSM claim links until a provider-specific OSM flow is configured." });
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    res.status(409).json({ error: "Claim invitations can be emailed only after this claim workflow is published." });
    return;
  }
  try {
    const result = await sendOsmInvite(sourceId, requested.sentTo);
    if (result.status === "ineligible") {
      res.status(409).json({ error: "Candidate is ineligible, suppressed, already claimed, or at an invitation limit." });
      return;
    }
    if (result.status !== "sent") {
      res.status(503).json({ error: result.status === "unknown"
        ? "Claim invitation delivery outcome is unknown; automatic resend is blocked to prevent duplicates."
        : "The email provider rejected the invitation." });
      return;
    }
    res.setHeader("Cache-Control", "no-store, private");
    res.status(201).json({
      id: String(result.id),
      sourceName: OSM_SOURCE,
      sourceId,
      sentTo: result.sentTo,
      method: "email",
      status: "sent",
      createdAt: new Date().toISOString(),
      errorCode: null,
    });
  } catch (error) {
    req.log.error({ err: error, sourceId }, "OSM invitation delivery or result persistence failed");
    res.status(503).json({ error: "Claim invitation delivery could not be durably confirmed." });
  }
}

router.post("/dashboard/osm-candidates/:sourceName/:sourceId/invites", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  const body = inviteInput.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A valid email address and delivery method are required." });
    return;
  }
  await deliverInvite(req, res, params.data.sourceId, body.data);
});

router.post("/dashboard/osm-candidates/:sourceName/:sourceId/invites/resend", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid candidate identity." });
    return;
  }
  await deliverInvite(req, res, params.data.sourceId, {});
});

router.post("/dashboard/osm-candidates/:sourceName/:sourceId/evidence/decision", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  const body = z.object({
    kind: z.enum(["ownership", "source_rights"]),
    decision: z.enum(["approved", "rejected"]),
    reviewerNote: z.string().max(2000).nullable().optional(),
  }).strict().safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid evidence decision." });
    return;
  }
  try {
    const changed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${params.data.sourceId}))`);
      const [workflow] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      )).limit(1);
      if (!workflow) return "missing" as const;
      if (workflow.suppressed || workflow.published) return "conflict" as const;
      const [evidence] = await tx.select().from(osmCandidateEvidenceTable).where(and(
        eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
        eq(osmCandidateEvidenceTable.sourceId, params.data.sourceId),
        eq(osmCandidateEvidenceTable.kind, body.data.kind),
      )).limit(1);
       if (!evidence || evidence.status === "not_submitted") return "not_submitted" as const;
       if (!isCurrentEvidenceSubmission({
         kind: body.data.kind,
         status: evidence.status,
         description: evidence.description,
         submittedAt: evidence.submittedAt,
         sourceAttribution: evidence.sourceAttribution,
       })) {
         return "not_current" as const;
       }
      const now = new Date();
      await tx.update(osmCandidateEvidenceTable).set({
        status: body.data.decision,
        reviewedAt: now,
        reviewedBy: "admin_session",
        reviewerNote: body.data.reviewerNote ?? null,
      }).where(eq(osmCandidateEvidenceTable.id, evidence.id));
      const evidenceRows = await tx.select().from(osmCandidateEvidenceTable).where(and(
        eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
        eq(osmCandidateEvidenceTable.sourceId, params.data.sourceId),
      ));
      const ownershipStatus = evidenceRows.find((item) => item.kind === "ownership")?.status;
      const rightsStatus = evidenceRows.find((item) => item.kind === "source_rights")?.status;
      const rightsConfirmed = rightsStatus === "approved";
      const state = workflow.suppressed
        ? "suppressed"
        : workflow.published
          ? "published"
          : workflow.claimed
            && workflow.identityVerified
            && ownershipStatus === "approved"
            && rightsConfirmed
            ? "claim_verified"
            : workflow.claimed
              ? "claim_invited"
              : workflow.reviewed
                ? "reviewed"
                : "unverified";
      await tx.update(osmCandidateWorkflowsTable).set({
        rightsConfirmed,
        state,
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      ));
      return "success" as const;
    });
    if (changed === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (changed !== "success") {
      res.status(409).json({ error: changed === "not_submitted"
        ? "Evidence has not been submitted."
        : changed === "not_current"
          ? "Evidence is no longer the current pending submission."
          : "Candidate is suppressed or published." });
      return;
    }
    const details = await getWorkflow(params.data.sourceId);
    if (!details) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow: _workflow, ...response } = details;
    res.setHeader("Cache-Control", "no-store, private");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM evidence decision failed");
    res.status(503).json({ error: "Evidence decision is unavailable." });
  }
});

router.put("/dashboard/osm-candidates/:sourceName/:sourceId/outreach", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  const body = z.object({ blocked: z.boolean() }).strict().safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid outreach preference." });
    return;
  }
  try {
    const [changed] = await db.update(osmCandidateWorkflowsTable).set({
      outreachBlocked: body.data.blocked,
      updatedAt: new Date(),
    }).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
      eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
    )).returning({ sourceId: osmCandidateWorkflowsTable.sourceId });
    if (!changed) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const details = await getWorkflow(params.data.sourceId);
    if (!details) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow: _workflow, ...response } = details;
    res.setHeader("Cache-Control", "no-store, private");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM outreach preference update failed");
    res.status(503).json({ error: "Outreach preference is unavailable." });
  }
});

const autoInviteInput = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(true),
    email: z.string().email().max(254),
    evidence: z.string().trim().min(10).max(2000),
  }).strict(),
  z.object({ enabled: z.literal(false) }).strict(),
]);

router.put("/dashboard/osm-candidates/:sourceName/:sourceId/auto-invite", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  const body = autoInviteInput.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "A reviewed business contact email and its source are required to enable automatic invitations." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${params.data.sourceId}))`);
      const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      )).limit(1);
      if (!current) return "missing" as const;
      if (body.data.enabled && (!current.reviewed || !current.highConfidence || current.suppressed
        || current.published || current.claimed || current.outreachBlocked)) return "conflict" as const;
      const now = new Date();
      await tx.update(osmCandidateWorkflowsTable).set(body.data.enabled ? {
        approvedContactEmail: body.data.email.trim().toLowerCase(),
        contactEvidence: body.data.evidence,
        contactApprovedAt: now,
        contactApprovedBy: "admin_session",
        autoInviteEnabled: true,
        updatedAt: now,
      } : { autoInviteEnabled: false, updatedAt: now }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      ));
      return "success" as const;
    });
    if (result !== "success") {
      res.status(result === "missing" ? 404 : 409).json({ error: result === "missing"
        ? "Candidate not found."
        : "Only reviewed, high-confidence, unclaimed candidates with outreach allowed can be enabled." });
      return;
    }
    const details = await getWorkflow(params.data.sourceId);
    if (!details) throw new Error("Candidate disappeared after contact approval.");
    const { workflow: _workflow, ...response } = details;
    res.setHeader("Cache-Control", "no-store, private");
    res.json(response);
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM automatic invitation preference update failed");
    res.status(503).json({ error: "Automatic invitation preference is unavailable." });
  }
});

router.get("/dashboard/osm-candidates/:sourceName/:sourceId/outreach-logs", adminOnly, async (req, res) => {
  const params = candidateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid candidate identity." });
    return;
  }
  try {
    const [workflow] = await db.select({ sourceId: osmCandidateWorkflowsTable.sourceId })
      .from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, params.data.sourceId),
      )).limit(1);
    if (!workflow) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const logs = await db.select().from(osmOutreachLogsTable).where(and(
      eq(osmOutreachLogsTable.sourceName, OSM_SOURCE),
      eq(osmOutreachLogsTable.sourceId, params.data.sourceId),
    )).orderBy(desc(osmOutreachLogsTable.createdAt)).limit(100);
    res.setHeader("Cache-Control", "no-store");
    res.json(logs.map((item) => ({
      id: String(item.id),
      sourceName: item.sourceName,
      sourceId: item.sourceId,
      sentTo: item.sentTo,
      method: item.method,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      errorCode: item.errorCode,
    })));
  } catch (error) {
    req.log.error({ err: error, sourceId: params.data.sourceId }, "OSM outreach history read failed");
    res.status(503).json({ error: "Outreach history is unavailable." });
  }
});

export default router;