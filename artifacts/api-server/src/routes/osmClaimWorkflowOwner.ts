import { timingSafeEqual } from "node:crypto";
import {
  analyticsEventsTable,
  db,
  externalCandidatesTable,
  osmActivationStatesTable,
  osmCandidateEvidenceTable,
  osmCandidateWorkflowsTable,
  osmClaimInvitesTable,
  osmOwnerSessionsTable,
  osmVerificationCodesTable,
  restaurantsTable,
  type OsmActivationError,
  type OsmOwnerDraftData,
} from "@workspace/db";
import {
  and,
  desc,
  eq,
  gte,
  isNull,
  sql,
} from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { GmailHttpError, sendGmailPlainText } from "../services/gmail/gmailClient";
import {
  CLAIM_INVITE_TTL_MS,
  OSM_SOURCE,
  OWNER_SESSION_TTL_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_CODE_TTL_MS,
  activationPreconditions,
  createOpaqueToken,
  createVerificationCode,
  hashOpaqueSecret,
  hashVerificationCode,
  normalizeOsmState,
  requiredFieldsComplete,
  safeProviderErrorCode,
} from "../services/osmCandidateWorkflow";
import { restaurantRank } from "../external/restaurantRank";

declare global {
  namespace Express {
    interface Request {
      osmOwner?: {
        sourceName: string;
        sourceId: string;
        tokenHash: string;
      };
    }
  }
}

const router: IRouter = Router();
const tokenSchema = z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/);
const exchangeBody = z.object({ claimToken: tokenSchema }).strict();
const claimExchangeLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many claim-link attempts. Try again later." },
});
const verificationBody = z.object({
  code: z.string().min(6).max(10).regex(/^[0-9]+$/),
}).strict();

function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Referrer-Policy", "no-referrer");
}

async function ownerSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  setNoStore(res);
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/.exec(req.get("authorization") ?? "");
  if (!match) {
    res.status(401).json({ error: "A valid owner session is required." });
    return;
  }
  const tokenHash = hashOpaqueSecret(match[1]);
  try {
    const [session] = await db.select().from(osmOwnerSessionsTable).where(and(
      eq(osmOwnerSessionsTable.tokenHash, tokenHash),
      isNull(osmOwnerSessionsTable.revokedAt),
      gte(osmOwnerSessionsTable.expiresAt, new Date()),
    )).limit(1);
    if (!session) {
      res.status(401).json({ error: "A valid owner session is required." });
      return;
    }
    const [workflow] = await db.select({
      suppressed: osmCandidateWorkflowsTable.suppressed,
    }).from(osmCandidateWorkflowsTable).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, session.sourceName),
      eq(osmCandidateWorkflowsTable.sourceId, session.sourceId),
    )).limit(1);
    if (!workflow || workflow.suppressed) {
      res.status(401).json({ error: "A valid owner session is required." });
      return;
    }
    req.osmOwner = {
      sourceName: session.sourceName,
      sourceId: session.sourceId,
      tokenHash,
    };
    next();
  } catch (error) {
    req.log.error({ err: error }, "OSM owner session lookup failed");
    res.status(503).json({ error: "Owner authentication is temporarily unavailable." });
  }
}

async function getOwnerContext(sourceId: string) {
  const [candidate] = await db.select().from(externalCandidatesTable).where(and(
    eq(externalCandidatesTable.sourceName, OSM_SOURCE),
    eq(externalCandidatesTable.sourceId, sourceId),
  )).limit(1);
  const [workflow] = await db.select().from(osmCandidateWorkflowsTable).where(and(
    eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
    eq(osmCandidateWorkflowsTable.sourceId, sourceId),
  )).limit(1);
  if (!candidate || !workflow) return null;
  const [evidence, activations] = await Promise.all([
    db.select().from(osmCandidateEvidenceTable).where(and(
      eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
      eq(osmCandidateEvidenceTable.sourceId, sourceId),
    )),
    db.select().from(osmActivationStatesTable).where(and(
      eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
      eq(osmActivationStatesTable.sourceId, sourceId),
    )).limit(1),
  ]);
  const ownership = evidence.find((item) => item.kind === "ownership");
  const rights = evidence.find((item) => item.kind === "source_rights");
  const activation = activations[0];
  const ownershipStatus = ownership?.status ?? "not_submitted";
  const rightsStatus = rights?.status ?? "not_submitted";
  return {
    candidate,
    workflow,
    ownershipStatus,
    rightsStatus,
    ownership,
    rights,
    activation,
    candidateResponse: {
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
      requiredFieldsComplete: requiredFieldsComplete(workflow.ownerDraft),
    },
    activationResponse: {
      promoted: activation?.promoted ?? false,
      enriched: activation?.enriched ?? false,
      scored: activation?.scored ?? false,
      published: activation?.published ?? false,
      currentStep: activation?.currentStep ?? null,
      errors: activation?.errors ?? [],
      activatedAt: activation?.activatedAt?.toISOString() ?? null,
    },
  };
}

async function exchangeClaimLink(req: Request, res: Response) {
  setNoStore(res);
  const body = exchangeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid claim invitation." });
    return;
  }
  let sessionToken: string;
  let expiresAt: Date;
  const claimTokenHash = hashOpaqueSecret(body.data.claimToken);
  try {
    sessionToken = createOpaqueToken();
    const sessionHash = hashOpaqueSecret(sessionToken);
    const now = new Date();
    expiresAt = new Date(now.getTime() + OWNER_SESSION_TTL_MS);
    const accepted = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(osmClaimInvitesTable).where(and(
        eq(osmClaimInvitesTable.tokenHash, claimTokenHash),
        eq(osmClaimInvitesTable.status, "sent"),
        isNull(osmClaimInvitesTable.usedAt),
        isNull(osmClaimInvitesTable.revokedAt),
        gte(osmClaimInvitesTable.expiresAt, now),
      )).limit(1);
      if (!invite) return false;
      const [workflow] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, invite.sourceId),
      )).limit(1);
      if (!workflow || workflow.suppressed || workflow.published || workflow.claimed) return false;
      const [consumed] = await tx.update(osmClaimInvitesTable).set({
        usedAt: now,
        status: "used",
      }).where(and(
        eq(osmClaimInvitesTable.id, invite.id),
        isNull(osmClaimInvitesTable.usedAt),
        isNull(osmClaimInvitesTable.revokedAt),
        eq(osmClaimInvitesTable.status, "sent"),
      )).returning({ id: osmClaimInvitesTable.id });
      if (!consumed) return false;
      const [changed] = await tx.update(osmCandidateWorkflowsTable).set({
        claimed: true,
        state: "claim_invited",
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, invite.sourceId),
        eq(osmCandidateWorkflowsTable.claimed, false),
        eq(osmCandidateWorkflowsTable.suppressed, false),
        eq(osmCandidateWorkflowsTable.published, false),
      )).returning({ sourceId: osmCandidateWorkflowsTable.sourceId });
      if (!changed) throw new Error("claim_state_conflict");
      await tx.insert(osmOwnerSessionsTable).values({
        tokenHash: sessionHash,
        sourceName: OSM_SOURCE,
        sourceId: invite.sourceId,
        createdAt: now,
        expiresAt,
      });
      return true;
    });
    if (!accepted) {
      res.status(400).json({ error: "Claim invitation is invalid, expired, used, or suppressed." });
      return;
    }
    const retrievedSessionHash = hashOpaqueSecret(sessionToken);
    const [session] = await db.select().from(osmOwnerSessionsTable).where(eq(
      osmOwnerSessionsTable.tokenHash,
      retrievedSessionHash,
    )).limit(1);
    if (!session) {
      res.status(503).json({ error: "Owner session could not be established." });
      return;
    }
    const [workflow] = await db.select().from(osmCandidateWorkflowsTable).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
      eq(osmCandidateWorkflowsTable.sourceId, session.sourceId),
    )).limit(1);
    res.json({
      ownerSession: sessionToken,
      expiresAt: expiresAt.toISOString(),
      dashboardMode: "pre_activation",
      state: workflow?.state ?? "claim_invited",
    });
  } catch (error) {
    req.log.error({ err: error }, "OSM claim invitation exchange failed");
    res.status(503).json({ error: "Claim invitation exchange is unavailable." });
  }
}

router.post("/claim/exchange", claimExchangeLimiter, exchangeClaimLink);
router.post("/claim/request", claimExchangeLimiter, exchangeClaimLink);

async function requestVerificationCode(req: Request, res: Response) {
  const owner = req.osmOwner!;
  const now = new Date();
  try {
    const details = await getOwnerContext(owner.sourceId);
    if (!details || !details.workflow.claimed || details.workflow.published) {
      res.status(409).json({ error: "This claim cannot request a verification code." });
      return;
    }
    const [invite] = await db.select().from(osmClaimInvitesTable).where(and(
      eq(osmClaimInvitesTable.sourceName, owner.sourceName),
      eq(osmClaimInvitesTable.sourceId, owner.sourceId),
      eq(osmClaimInvitesTable.status, "used"),
    )).orderBy(desc(osmClaimInvitesTable.usedAt)).limit(1);
    if (!invite) {
      res.status(409).json({ error: "The verified invitation address is unavailable." });
      return;
    }
    const rawCode = createVerificationCode();
    const codeHash = hashVerificationCode(rawCode);
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner.tokenHash}))`);
      const codes = await tx.select({
        createdAt: osmVerificationCodesTable.createdAt,
      }).from(osmVerificationCodesTable).where(and(
        eq(osmVerificationCodesTable.ownerSessionHash, owner.tokenHash),
        gte(osmVerificationCodesTable.createdAt, new Date(now.getTime() - 60 * 60 * 1_000)),
      )).orderBy(desc(osmVerificationCodesTable.createdAt)).limit(10);
      const latest = codes[0];
      if (codes.length >= 3 || (latest && now.getTime() - latest.createdAt.getTime() < 60_000)) {
        return false;
      }
      await tx.update(osmVerificationCodesTable).set({ usedAt: now }).where(and(
        eq(osmVerificationCodesTable.ownerSessionHash, owner.tokenHash),
        isNull(osmVerificationCodesTable.usedAt),
      ));
      await tx.insert(osmVerificationCodesTable).values({
        ownerSessionHash: owner.tokenHash,
        codeHash,
        createdAt: now,
        expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
        attempts: 0,
      });
      return true;
    });
    if (!created) {
      res.status(429).json({ error: "Verification code rate limit reached." });
      return;
    }
    try {
      await sendGmailPlainText({
        to: invite.sentTo,
        subject: "Your restaurant listing verification code",
        body: [
          "Use this code to verify control of the invitation email address:",
          "",
          rawCode,
          "",
          "The code expires in ten minutes and can only be used once. This confirms email access, not business ownership.",
        ].join("\r\n"),
      });
      await db.update(osmVerificationCodesTable).set({ sentAt: new Date() }).where(and(
        eq(osmVerificationCodesTable.ownerSessionHash, owner.tokenHash),
        eq(osmVerificationCodesTable.codeHash, codeHash),
        isNull(osmVerificationCodesTable.usedAt),
      ));
    } catch (error) {
      const errorCode = safeProviderErrorCode(error);
      await db.update(osmVerificationCodesTable).set({ usedAt: new Date() }).where(and(
        eq(osmVerificationCodesTable.ownerSessionHash, owner.tokenHash),
        eq(osmVerificationCodesTable.codeHash, codeHash),
        isNull(osmVerificationCodesTable.usedAt),
      ));
      req.log.warn({ sourceId: owner.sourceId, errorCode }, "OSM verification email delivery failed");
      res.status(503).json({ error: error instanceof GmailHttpError
        ? "The email provider could not send a verification code."
        : "Verification delivery outcome is unknown; request another code after the cooldown." });
      return;
    }
    res.status(202).end();
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM verification code request failed");
    res.status(503).json({ error: "Verification code delivery is unavailable." });
  }
}

router.post("/claim/verification-code/request", ownerSession, requestVerificationCode);
router.post("/claim/verify/request", ownerSession, requestVerificationCode);

async function submitVerificationCode(req: Request, res: Response) {
  const owner = req.osmOwner!;
  const body = verificationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid verification code." });
    return;
  }
  try {
    const now = new Date();
    const codeHash = hashVerificationCode(body.data.code);
    const result = await db.transaction(async (tx) => {
      const [code] = await tx.select().from(osmVerificationCodesTable).where(and(
        eq(osmVerificationCodesTable.ownerSessionHash, owner.tokenHash),
        isNull(osmVerificationCodesTable.usedAt),
        gte(osmVerificationCodesTable.expiresAt, now),
      )).orderBy(desc(osmVerificationCodesTable.createdAt)).limit(1);
      const hashesMatch = code
        && Buffer.byteLength(code.codeHash) === Buffer.byteLength(codeHash)
        && timingSafeEqual(Buffer.from(code.codeHash), Buffer.from(codeHash));
      if (code && hashesMatch && code.attempts < VERIFICATION_CODE_MAX_ATTEMPTS) {
        const [used] = await tx.update(osmVerificationCodesTable).set({
          usedAt: now,
          attempts: code.attempts + 1,
        }).where(and(
          eq(osmVerificationCodesTable.id, code.id),
          isNull(osmVerificationCodesTable.usedAt),
          eq(osmVerificationCodesTable.attempts, code.attempts),
          sql`${osmVerificationCodesTable.attempts} < ${VERIFICATION_CODE_MAX_ATTEMPTS}`,
        )).returning({ id: osmVerificationCodesTable.id });
        if (!used) return "invalid" as const;
        const [workflow] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
          eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
          eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
        )).limit(1);
        if (!workflow || workflow.suppressed || workflow.published) return "invalid" as const;
        const ownershipRows = await tx.select().from(osmCandidateEvidenceTable).where(and(
          eq(osmCandidateEvidenceTable.sourceName, owner.sourceName),
          eq(osmCandidateEvidenceTable.sourceId, owner.sourceId),
        ));
        const ownershipStatus = ownershipRows.find((item) => item.kind === "ownership")?.status;
        const rightsStatus = ownershipRows.find((item) => item.kind === "source_rights")?.status;
        const state = normalizeOsmState(workflow.state as never, {
          reviewed: workflow.reviewed,
          claimed: workflow.claimed,
          identityVerified: true,
          ownershipStatus: ownershipStatus as never ?? "not_submitted",
          rightsStatus: rightsStatus as never ?? "not_submitted",
          suppressed: workflow.suppressed,
          published: workflow.published,
        });
        await tx.update(osmCandidateWorkflowsTable).set({
          identityVerified: true,
          state,
          updatedAt: now,
        }).where(and(
          eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
          eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
          eq(osmCandidateWorkflowsTable.suppressed, false),
          eq(osmCandidateWorkflowsTable.published, false),
        ));
        return { identityVerified: true, state };
      }
      if (code) {
        await tx.update(osmVerificationCodesTable).set({
          attempts: code.attempts + 1,
          ...(code.attempts + 1 >= VERIFICATION_CODE_MAX_ATTEMPTS ? { usedAt: now } : {}),
        }).where(and(
          eq(osmVerificationCodesTable.id, code.id),
          isNull(osmVerificationCodesTable.usedAt),
          eq(osmVerificationCodesTable.attempts, code.attempts),
        ));
      }
      return "invalid" as const;
    });
    if (result === "invalid") {
      res.status(400).json({ error: "Invalid, expired, exhausted, or previously used code." });
      return;
    }
    res.json(result);
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM verification code submission failed");
    res.status(503).json({ error: "Contact verification is unavailable." });
  }
}

router.post("/claim/verification-code/submit", ownerSession, submitVerificationCode);
router.post("/claim/verify", ownerSession, submitVerificationCode);
router.post("/claim/verify/submit", ownerSession, submitVerificationCode);

const evidenceBody = z.object({
  ownershipDescription: z.string().trim().min(10).max(4000),
  ownershipEvidenceUrl: z.string().url().max(2048).nullable().optional(),
  rightsDescription: z.string().trim().min(10).max(4000),
  rightsEvidenceUrl: z.string().url().max(2048).nullable().optional(),
  sourceAttribution: z.string().trim().min(1).max(1000)
    .refine((value) => /openstreetmap/i.test(value), "OpenStreetMap attribution is required."),
}).strict();

async function submitEvidence(req: Request, res: Response) {
  const owner = req.osmOwner!;
  const body = evidenceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Ownership, source-rights, and OpenStreetMap attribution evidence are required." });
    return;
  }
  try {
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${owner.sourceId}))`);
      const [workflow] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
        eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
      )).limit(1);
      if (!workflow) return "missing" as const;
      if (workflow.suppressed || workflow.published || !workflow.claimed || !workflow.identityVerified) {
        return "conflict" as const;
      }
      const evidence = [
        {
          sourceName: owner.sourceName,
          sourceId: owner.sourceId,
          kind: "ownership",
          description: body.data.ownershipDescription,
          evidenceUrl: body.data.ownershipEvidenceUrl ?? null,
          sourceAttribution: null,
          status: "pending",
          submittedAt: now,
          reviewedAt: null,
          reviewedBy: null,
          reviewerNote: null,
        },
        {
          sourceName: owner.sourceName,
          sourceId: owner.sourceId,
          kind: "source_rights",
          description: body.data.rightsDescription,
          evidenceUrl: body.data.rightsEvidenceUrl ?? null,
          sourceAttribution: body.data.sourceAttribution,
          status: "pending",
          submittedAt: now,
          reviewedAt: null,
          reviewedBy: null,
          reviewerNote: null,
        },
      ];
      for (const item of evidence) {
        await tx.insert(osmCandidateEvidenceTable).values(item).onConflictDoUpdate({
          target: [
            osmCandidateEvidenceTable.sourceName,
            osmCandidateEvidenceTable.sourceId,
            osmCandidateEvidenceTable.kind,
          ],
          set: {
            description: item.description,
            evidenceUrl: item.evidenceUrl,
            sourceAttribution: item.sourceAttribution,
            status: "pending",
            submittedAt: now,
            reviewedAt: null,
            reviewedBy: null,
            reviewerNote: null,
          },
        });
      }
      await tx.update(osmCandidateWorkflowsTable).set({
        rightsConfirmed: false,
        state: "claim_invited",
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
        eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
      ));
      return "success" as const;
    });
    if (result === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (result === "conflict") {
      res.status(409).json({ error: "Candidate is suppressed, published, or has not verified the invited email." });
      return;
    }
    res.json({
      ownershipStatus: "pending",
      rightsStatus: "pending",
      submittedAt: now.toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM claim evidence submission failed");
    res.status(503).json({ error: "Evidence submission is unavailable." });
  }
}

router.put("/claim/evidence", ownerSession, submitEvidence);
router.post("/claim/rights", ownerSession, submitEvidence);
router.post("/claim/rights/confirm", ownerSession, submitEvidence);

const draftInput = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  city: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  website: z.string().url().max(2048).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  openingHours: z.array(z.string().trim().min(1).max(200)).max(14).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

router.patch("/owner/claim/draft", ownerSession, async (req, res) => {
  const owner = req.osmOwner!;
  const body = draftInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid owner draft." });
    return;
  }
  try {
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${owner.sourceId}))`);
      const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
        eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
      )).limit(1);
      if (!current) return { kind: "missing" as const };
      if (current.suppressed || current.published || current.state === "activated") {
        return { kind: "conflict" as const };
      }
      const draft: OsmOwnerDraftData = { ...current.ownerDraft, ...body.data };
      // An approval applies to the version the reviewer saw. Do not let a
      // later draft edit silently change a reviewed listing before publication.
      if (JSON.stringify(draft) !== JSON.stringify(current.ownerDraft)) {
        const approved = await tx.select({ id: osmCandidateEvidenceTable.id })
          .from(osmCandidateEvidenceTable)
          .where(and(
            eq(osmCandidateEvidenceTable.sourceName, owner.sourceName),
            eq(osmCandidateEvidenceTable.sourceId, owner.sourceId),
            eq(osmCandidateEvidenceTable.status, "approved"),
          )).limit(1);
        if (approved.length) return { kind: "reviewed_draft" as const };
      }
      const identityFieldsChanged = (
        ["name", "address", "city", "latitude", "longitude"] as const
      ).some((key) => body.data[key] !== undefined && body.data[key] !== current.ownerDraft[key]);
      const [row] = await tx.update(osmCandidateWorkflowsTable).set({
        ownerDraft: draft,
        ...(identityFieldsChanged
          ? { state: current.claimed ? "claim_invited" : "reviewed" }
          : {}),
        updatedAt: now,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
        eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
        eq(osmCandidateWorkflowsTable.suppressed, false),
        eq(osmCandidateWorkflowsTable.published, false),
      )).returning({ sourceId: osmCandidateWorkflowsTable.sourceId });
      if (row && identityFieldsChanged) {
        await tx.update(osmCandidateEvidenceTable).set({
          status: "pending",
          submittedAt: now,
          reviewedAt: null,
          reviewedBy: null,
          reviewerNote: null,
        }).where(and(
          eq(osmCandidateEvidenceTable.sourceName, owner.sourceName),
          eq(osmCandidateEvidenceTable.sourceId, owner.sourceId),
          eq(osmCandidateEvidenceTable.kind, "ownership"),
          eq(osmCandidateEvidenceTable.status, "approved"),
        ));
      }
      return row ? { kind: "success" as const, draft } : { kind: "conflict" as const };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: "The owner draft cannot be changed after activation begins." });
      return;
    }
    if (result.kind === "reviewed_draft") {
      res.status(409).json({ error: "A reviewer has approved evidence for this draft. Resubmit your evidence to request changes before activation." });
      return;
    }
    res.json({
      ...result.draft,
      requiredFieldsComplete: requiredFieldsComplete(result.draft),
    });
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM owner draft update failed");
    res.status(503).json({ error: "Owner draft is unavailable." });
  }
});

router.get("/owner/claim/dashboard", ownerSession, async (req, res) => {
  const owner = req.osmOwner!;
  try {
    const context = await getOwnerContext(owner.sourceId);
    if (!context) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    const { workflow } = context;
    const dashboardMode = workflow.published ? "activated" : "pre_activation";
    res.json({
      dashboardMode,
      candidate: context.candidateResponse,
      draft: {
        ...workflow.ownerDraft,
        requiredFieldsComplete: requiredFieldsComplete(workflow.ownerDraft),
      },
      evidence: {
        ownershipStatus: context.ownershipStatus,
        rightsStatus: context.rightsStatus,
      },
      activation: context.activationResponse,
    });
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM owner dashboard read failed");
    res.status(503).json({ error: "Owner dashboard is unavailable." });
  }
});

router.get("/owner/claim/analytics", ownerSession, async (req, res) => {
  const owner = req.osmOwner!;
  try {
    const [workflow] = await db.select().from(osmCandidateWorkflowsTable).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
      eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
    )).limit(1);
    if (!workflow) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (!workflow.published || !workflow.restaurantPlaceId) {
      res.status(409).json({ error: "Analytics are available after activation." });
      return;
    }
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
    const [[totals], [recent]] = await Promise.all([
      db.select({
        views: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'profile_view' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_profile')`.mapWith(Number),
        searches: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'search_impression' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_search')`.mapWith(Number),
        clicks: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'click' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_click')`.mapWith(Number),
      }).from(analyticsEventsTable).where(eq(analyticsEventsTable.restaurantId, workflow.restaurantPlaceId)),
      db.select({
        views: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'profile_view' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_profile')`.mapWith(Number),
        searches: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'search_impression' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_search')`.mapWith(Number),
        clicks: sql<number>`count(*) filter (where ${analyticsEventsTable.type} = 'click' and ${analyticsEventsTable.metadata} ->> 'source' = 'server_click')`.mapWith(Number),
      }).from(analyticsEventsTable).where(and(
        eq(analyticsEventsTable.restaurantId, workflow.restaurantPlaceId),
        gte(analyticsEventsTable.createdAt, cutoff),
      )),
    ]);
    res.json({
      views: totals?.views ?? 0,
      searches: totals?.searches ?? 0,
      clicks: totals?.clicks ?? 0,
      last30Days: {
        views: recent?.views ?? 0,
        searches: recent?.searches ?? 0,
        clicks: recent?.clicks ?? 0,
      },
    });
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM owner analytics read failed");
    res.status(503).json({ error: "Owner analytics are unavailable." });
  }
});

router.put("/owner/claim/outreach-preference", ownerSession, async (req, res) => {
  const owner = req.osmOwner!;
  const body = z.object({ disabled: z.boolean() }).strict().safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid outreach preference." });
    return;
  }
  try {
    const now = new Date();
    const [updated] = await db.update(osmCandidateWorkflowsTable).set({
      ownerOutreachDisabled: body.data.disabled,
      updatedAt: now,
    }).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, owner.sourceName),
      eq(osmCandidateWorkflowsTable.sourceId, owner.sourceId),
      eq(osmCandidateWorkflowsTable.suppressed, false),
    )).returning({ sourceId: osmCandidateWorkflowsTable.sourceId });
    if (!updated) {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    res.json({ disabled: body.data.disabled, updatedAt: now.toISOString() });
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM owner outreach preference update failed");
    res.status(503).json({ error: "Owner outreach preference is unavailable." });
  }
});

function activationProgress(value: typeof osmActivationStatesTable.$inferSelect | undefined) {
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

function encodedOsmPlaceId(sourceId: string): string {
  return `osm:${encodeURIComponent(sourceId)}`;
}

async function lockWorkflow(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sourceId: string,
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${sourceId}))`);
}

async function activationContext(sourceId: string) {
  const context = await getOwnerContext(sourceId);
  if (!context) return null;
  const { workflow } = context;
  const gate = activationPreconditions({
    state: workflow.state as never,
    reviewed: workflow.reviewed,
    claimed: workflow.claimed,
    identityVerified: workflow.identityVerified,
    ownershipStatus: context.ownershipStatus as never,
    rightsStatus: context.rightsStatus as never,
    suppressed: workflow.suppressed,
    published: workflow.published,
    draft: workflow.ownerDraft,
  });
  return { context, gate };
}

async function recordActivationError(sourceId: string, step: OsmActivationError["step"], error: unknown) {
  const [current] = await db.select().from(osmActivationStatesTable).where(and(
    eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
    eq(osmActivationStatesTable.sourceId, sourceId),
  )).limit(1);
  const errorCode = safeProviderErrorCode(error);
  const errors = [
    ...(current?.errors ?? []),
    { step, errorCode, timestamp: new Date().toISOString() },
  ].slice(-20);
  await db.insert(osmActivationStatesTable).values({
    sourceName: OSM_SOURCE,
    sourceId,
    errors,
    currentStep: step,
  }).onConflictDoUpdate({
    target: [osmActivationStatesTable.sourceName, osmActivationStatesTable.sourceId],
    set: { errors, currentStep: step, updatedAt: new Date() },
  });
}

async function runActivation(sourceId: string) {
  const evaluated = await activationContext(sourceId);
  if (!evaluated) return { kind: "missing" as const };
  if (evaluated.context.workflow.published) {
    const persisted = activationProgress(evaluated.context.activation);
    return {
      kind: "success" as const,
      progress: {
        ...persisted,
        published: true,
        activatedAt: persisted.activatedAt
          ?? evaluated.context.workflow.activatedAt?.toISOString()
          ?? null,
      },
    };
  }
  if (!evaluated.gate.eligible) {
    return { kind: "blocked" as const, reason: evaluated.gate.reason };
  }
  const { workflow, candidate } = evaluated.context;
  const now = new Date();
  const placeId = workflow.restaurantPlaceId ?? encodedOsmPlaceId(sourceId);

  if (!evaluated.context.activation?.promoted) {
    try {
      await db.transaction(async (tx) => {
        await lockWorkflow(tx, sourceId);
        const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
          eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
          eq(osmCandidateWorkflowsTable.sourceId, sourceId),
        )).limit(1);
        if (!current || current.suppressed || current.published || !current.identityVerified
          || !current.rightsConfirmed || current.state !== "claim_verified"
          || !requiredFieldsComplete(current.ownerDraft)) {
          throw new Error("activation_gate_changed");
        }
        const decisions = await tx.select({
          kind: osmCandidateEvidenceTable.kind,
          status: osmCandidateEvidenceTable.status,
        }).from(osmCandidateEvidenceTable).where(and(
          eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
          eq(osmCandidateEvidenceTable.sourceId, sourceId),
        ));
        if (!decisions.some((item) => item.kind === "ownership" && item.status === "approved")
          || !decisions.some((item) => item.kind === "source_rights" && item.status === "approved")) {
          throw new Error("activation_evidence_gate_changed");
        }
        const [existing] = await tx.select().from(restaurantsTable).where(and(
          eq(restaurantsTable.sourceName, OSM_SOURCE),
          eq(restaurantsTable.sourceId, sourceId),
        )).limit(1);
        if (existing?.published) throw new Error("osm_listing_already_published");
        if (!existing) {
          await tx.insert(restaurantsTable).values({
            placeId,
            sourceName: OSM_SOURCE,
            sourceId,
            sourceAttribution: "© OpenStreetMap contributors, Open Database Licence (ODbL)",
            published: false,
            name: current.ownerDraft.name,
            address: current.ownerDraft.address!,
            city: current.ownerDraft.city!,
            latitude: current.ownerDraft.latitude,
            longitude: current.ownerDraft.longitude,
            googleMapsUrl: null,
            claimEmail: (await tx.select({ sentTo: osmClaimInvitesTable.sentTo })
              .from(osmClaimInvitesTable)
              .where(and(
                eq(osmClaimInvitesTable.sourceName, OSM_SOURCE),
                eq(osmClaimInvitesTable.sourceId, sourceId),
                eq(osmClaimInvitesTable.status, "used"),
              )).orderBy(desc(osmClaimInvitesTable.usedAt)).limit(1))[0]?.sentTo ?? null,
            claimStatus: "basic",
            claimedAt: now,
            outreachStatus: "suppressed",
            suppressedAt: now,
            suppressionReason: "owner_claimed",
          });
        } else if (existing.placeId !== placeId) {
          throw new Error("osm_listing_identity_conflict");
        }
        await tx.update(osmCandidateWorkflowsTable).set({
          state: "activated",
          restaurantPlaceId: existing?.placeId ?? placeId,
          activatedAt: current.activatedAt ?? now,
          updatedAt: now,
        }).where(and(
          eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
          eq(osmCandidateWorkflowsTable.sourceId, sourceId),
          eq(osmCandidateWorkflowsTable.suppressed, false),
          eq(osmCandidateWorkflowsTable.published, false),
        ));
        await tx.insert(osmActivationStatesTable).values({
          sourceName: OSM_SOURCE,
          sourceId,
          promoted: true,
          currentStep: "enrichment",
          activatedAt: now,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [osmActivationStatesTable.sourceName, osmActivationStatesTable.sourceId],
          set: {
            promoted: true,
            currentStep: "enrichment",
            activatedAt: now,
            updatedAt: now,
          },
        });
      });
    } catch (error) {
      await recordActivationError(sourceId, "promotion", error);
      return { kind: "failed" as const, step: "promotion" };
    }
  }

  const [currentActivation] = await db.select().from(osmActivationStatesTable).where(and(
    eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
    eq(osmActivationStatesTable.sourceId, sourceId),
  )).limit(1);

  if (!currentActivation?.enriched) {
    try {
      const [latestWorkflow] = await db.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, sourceId),
      )).limit(1);
      if (!latestWorkflow || latestWorkflow.suppressed || latestWorkflow.published) {
        throw new Error("activation_gate_changed");
      }
      await db.transaction(async (tx) => {
        await lockWorkflow(tx, sourceId);
        await tx.update(restaurantsTable).set({
          phone: latestWorkflow.ownerDraft.phone,
          website: latestWorkflow.ownerDraft.website,
          ownerDescription: latestWorkflow.ownerDraft.description,
          openingHours: latestWorkflow.ownerDraft.openingHours,
          latitude: latestWorkflow.ownerDraft.latitude,
          longitude: latestWorkflow.ownerDraft.longitude,
          enrichedAt: new Date(),
          enrichmentStatus: "completed",
        }).where(and(
          eq(restaurantsTable.placeId, placeId),
          eq(restaurantsTable.sourceName, OSM_SOURCE),
          eq(restaurantsTable.published, false),
        ));
        await tx.update(osmActivationStatesTable).set({
          enriched: true,
          currentStep: "scoring",
          updatedAt: new Date(),
        }).where(and(
          eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
          eq(osmActivationStatesTable.sourceId, sourceId),
        ));
      });
    } catch (error) {
      await recordActivationError(sourceId, "enrichment", error);
      return { kind: "failed" as const, step: "enrichment" };
    }
  }

  const [activationAfterEnrichment] = await db.select().from(osmActivationStatesTable).where(and(
    eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
    eq(osmActivationStatesTable.sourceId, sourceId),
  )).limit(1);
  if (!activationAfterEnrichment?.scored) {
    try {
      const draft = workflow.ownerDraft;
      const score = restaurantRank({
        website: draft.website,
        phone: draft.phone,
        cuisine: null,
        openingHours: draft.openingHours.length ? draft.openingHours.join(", ") : null,
        delivery: false,
        takeaway: false,
        wheelchairAccessible: false,
      });
      await db.transaction(async (tx) => {
        await lockWorkflow(tx, sourceId);
        await tx.update(restaurantsTable).set({
          qualificationScore: score,
          qualificationReason: "Completeness score uses owner-supplied contact and opening-hour fields; no ratings, reviews, or unsupported facts are inferred.",
          qualifiedAt: new Date(),
          rankingScore: score,
          rankingUpdatedAt: new Date(),
        }).where(and(
          eq(restaurantsTable.placeId, placeId),
          eq(restaurantsTable.sourceName, OSM_SOURCE),
          eq(restaurantsTable.published, false),
        ));
        await tx.update(osmActivationStatesTable).set({
          scored: true,
          currentStep: "publication",
          updatedAt: new Date(),
        }).where(and(
          eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
          eq(osmActivationStatesTable.sourceId, sourceId),
        ));
      });
    } catch (error) {
      await recordActivationError(sourceId, "scoring", error);
      return { kind: "failed" as const, step: "scoring" };
    }
  }

  try {
    await db.transaction(async (tx) => {
      await lockWorkflow(tx, sourceId);
      const [current] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, sourceId),
      )).limit(1);
      if (!current || current.suppressed || !current.reviewed || !current.claimed
        || !current.identityVerified || !current.rightsConfirmed
        || !requiredFieldsComplete(current.ownerDraft)) {
        throw new Error("activation_gate_changed");
      }
      if (current.published) return;
      const decisions = await tx.select({
        kind: osmCandidateEvidenceTable.kind,
        status: osmCandidateEvidenceTable.status,
      }).from(osmCandidateEvidenceTable).where(and(
        eq(osmCandidateEvidenceTable.sourceName, OSM_SOURCE),
        eq(osmCandidateEvidenceTable.sourceId, sourceId),
      ));
      if (!decisions.some((item) => item.kind === "ownership" && item.status === "approved")
        || !decisions.some((item) => item.kind === "source_rights" && item.status === "approved")) {
        throw new Error("activation_evidence_gate_changed");
      }
      await tx.update(restaurantsTable).set({
        published: true,
        publishedAt: new Date(),
        sourceAttribution: "© OpenStreetMap contributors, Open Database Licence (ODbL)",
      }).where(and(
        eq(restaurantsTable.placeId, current.restaurantPlaceId ?? placeId),
        eq(restaurantsTable.sourceName, OSM_SOURCE),
        eq(restaurantsTable.published, false),
      ));
      const [published] = await tx.select({ placeId: restaurantsTable.placeId }).from(restaurantsTable).where(and(
        eq(restaurantsTable.placeId, current.restaurantPlaceId ?? placeId),
        eq(restaurantsTable.published, true),
      )).limit(1);
      if (!published) throw new Error("publication_not_committed");
      const publishedAt = new Date();
      await tx.update(osmCandidateWorkflowsTable).set({
        state: "published",
        published: true,
        restaurantPlaceId: published.placeId,
        activatedAt: current.activatedAt ?? publishedAt,
        updatedAt: publishedAt,
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, sourceId),
        eq(osmCandidateWorkflowsTable.suppressed, false),
      ));
      await tx.update(osmActivationStatesTable).set({
        published: true,
        currentStep: null,
        updatedAt: publishedAt,
      }).where(and(
        eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
        eq(osmActivationStatesTable.sourceId, sourceId),
      ));
    });
  } catch (error) {
    await recordActivationError(sourceId, "publication", error);
    return { kind: "failed" as const, step: "publication" };
  }

  const [finalState] = await db.select().from(osmActivationStatesTable).where(and(
    eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
    eq(osmActivationStatesTable.sourceId, sourceId),
  )).limit(1);
  return { kind: "success" as const, progress: activationProgress(finalState) };
}

async function activateOwnerListing(req: Request, res: Response) {
  const owner = req.osmOwner!;
  try {
    const result = await runActivation(owner.sourceId);
    if (result.kind === "missing") {
      res.status(404).json({ error: "Candidate not found." });
      return;
    }
    if (result.kind === "blocked") {
      res.status(409).json({ error: `Activation is blocked: ${result.reason}.` });
      return;
    }
    if (result.kind === "failed") {
      const [activation] = await db.select().from(osmActivationStatesTable).where(and(
        eq(osmActivationStatesTable.sourceName, OSM_SOURCE),
        eq(osmActivationStatesTable.sourceId, owner.sourceId),
      )).limit(1);
      res.status(503).json(activationProgress(activation));
      return;
    }
    res.json(result.progress);
  } catch (error) {
    req.log.error({ err: error, sourceId: owner.sourceId }, "OSM owner activation failed");
    res.status(503).json({ error: "Owner activation is temporarily unavailable." });
  }
}

router.post("/owner/claim/activate", ownerSession, activateOwnerListing);
router.post("/claim/activate", ownerSession, activateOwnerListing);

export default router;