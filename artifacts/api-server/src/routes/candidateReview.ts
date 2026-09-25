import { db, externalCandidatesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();
const candidateIdSchema = z.string().min(1).max(512).refine((id) => id.trim() === id);
type ReviewAction = "verify" | "reject";

async function reviewCandidate(sourceId: string, action: ReviewAction) {
  const matches = await db
    .select({
      sourceName: externalCandidatesTable.sourceName,
      verificationStatus: externalCandidatesTable.verificationStatus,
    })
    .from(externalCandidatesTable)
    .where(eq(externalCandidatesTable.sourceId, sourceId))
    .limit(2);

  if (!matches.length) return { kind: "missing" } as const;
  // The database key is (source_name, source_id). Never silently review two sources.
  if (matches.length > 1) return { kind: "ambiguous" } as const;

  const { sourceName, verificationStatus } = matches[0];
  // OSM candidates use the gated workflow routes; never let a legacy review
  // action bypass evidence approval or alter publication/suppression state.
  if (sourceName === "OSM") return { kind: "conflict" } as const;
  const desired = action === "verify" ? "verified" : "rejected";
  if (verificationStatus === desired) {
    return { kind: "success", sourceName, changed: false } as const;
  }
  if (verificationStatus === "promoted" || verificationStatus === "rejected") {
    return { kind: "conflict" } as const;
  }

  // Reject can override review, but verify cannot undo permanent rejection.
  const fromStatuses = action === "reject"
    ? ["unverified", "review_ready", "verified"]
    : ["unverified", "review_ready"];
  const updated = await db
    .update(externalCandidatesTable)
    .set({ verificationStatus: desired })
    .where(and(
      eq(externalCandidatesTable.sourceName, sourceName),
      eq(externalCandidatesTable.sourceId, sourceId),
      inArray(externalCandidatesTable.verificationStatus, fromStatuses),
    ))
    .returning({ sourceId: externalCandidatesTable.sourceId });
  if (updated.length) return { kind: "success", sourceName, changed: true } as const;

  // Resolve a concurrent review deterministically rather than claiming success.
  const [current] = await db
    .select({ verificationStatus: externalCandidatesTable.verificationStatus })
    .from(externalCandidatesTable)
    .where(and(
      eq(externalCandidatesTable.sourceName, sourceName),
      eq(externalCandidatesTable.sourceId, sourceId),
    ))
    .limit(1);
  if (!current) return { kind: "missing" } as const;
  return current.verificationStatus === desired
    ? { kind: "success", sourceName, changed: false } as const
    : { kind: "conflict" } as const;
}

function registerReview(action: ReviewAction) {
  router.post(`/candidates/:id/${action}`, adminOnly, async (req, res) => {
    const parsed = candidateIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ error: "A valid candidate source ID is required." });
      return;
    }
    try {
      const result = await reviewCandidate(parsed.data, action);
      if (result.kind === "missing") {
        res.status(404).json({ error: "candidate_not_found" });
        return;
      }
      if (result.kind === "ambiguous") {
        res.status(409).json({ error: "candidate_source_id_ambiguous" });
        return;
      }
      if (result.kind === "conflict") {
        res.status(409).json({ error: "candidate_review_conflict" });
        return;
      }
      if (result.changed) {
        req.log.info(
          { sourceName: result.sourceName, sourceId: parsed.data, action },
          "External candidate review status changed",
        );
      }
      res.json({
        status: action === "verify" ? "verified_pending_publication" : "suppressed_permanently",
        candidateId: parsed.data,
        sourceName: result.sourceName,
        verificationStatus: action === "verify" ? "verified" : "rejected",
        changed: result.changed,
      });
    } catch (error) {
      req.log.error({ err: error, sourceId: parsed.data, action }, "External candidate review failed");
      res.status(503).json({ error: "Candidate review is unavailable." });
    }
  });
}

registerReview("verify");
registerReview("reject");

export default router;