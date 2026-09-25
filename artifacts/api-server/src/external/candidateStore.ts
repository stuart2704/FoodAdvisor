import {
  db,
  externalCandidatesTable,
  osmCandidateWorkflowsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ExternalCandidate } from "./candidateTypes";
import { isReadyForCandidateReview } from "./candidateReviewEligibility";
import { logger } from "../lib/logger";

/**
 * Store external candidates as unpublished. High-completeness candidates
 * are ready for review, but are not identity- or rights-verified.
 * This does NOT create restaurants.
 * This does NOT trigger outreach.
 * This does NOT fabricate Google fields.
 */
export async function storeExternalCandidates(
  candidates: ExternalCandidate[],
  now: Date
): Promise<void> {
  if (candidates.length === 0) {
    logger.info({ at: now.toISOString() }, "No external candidates to store");
    return;
  }

  for (const c of candidates) {
    if (!c.sourceName.trim() || !c.sourceId.trim() || !c.rawName.trim()) {
      throw new Error("External candidate requires sourceName, sourceId, and rawName.");
    }
  }

  const inserted = await db.transaction(async (tx) => {
    let count = 0;
    for (const c of candidates) {
      const readyForReview = isReadyForCandidateReview(c);
      const rows = await tx
        .insert(externalCandidatesTable)
        .values({
          sourceId: c.sourceId,
          sourceName: c.sourceName,
          rawName: c.rawName,
          rawAddress: c.rawAddress,
          rawLat: c.rawCoords?.lat ?? null,
          rawLon: c.rawCoords?.lon ?? null,
          rawPhone: c.rawPhone,
          rawWebsite: c.rawWebsite,
          sourceFlags: c.sourceFlags,
          importedAt: now,
          verificationStatus: readyForReview ? "review_ready" : "unverified",
        })
        .onConflictDoNothing({
          // A re-import must never undo an admin rejection or review.
          target: [externalCandidatesTable.sourceName, externalCandidatesTable.sourceId],
        })
        .returning({ sourceId: externalCandidatesTable.sourceId });
      count += rows.length;
      if (!rows.length && readyForReview) {
        // Existing unreviewed candidates can become review-ready on a later
        // import, but never overwrite a verified or rejected decision.
        await tx.update(externalCandidatesTable)
          .set({ verificationStatus: "review_ready" })
          .where(and(
            eq(externalCandidatesTable.sourceName, c.sourceName),
            eq(externalCandidatesTable.sourceId, c.sourceId),
            eq(externalCandidatesTable.verificationStatus, "unverified"),
          ));
      }
      if (c.sourceName === "OSM") {
        await tx
          .insert(osmCandidateWorkflowsTable)
          .values({
            sourceName: c.sourceName,
            sourceId: c.sourceId,
            // Ingestion always begins unverified. Completeness is only a
            // review-priority signal and never sends an invite or publishes.
            state: "unverified",
            highConfidence: readyForReview,
            ownerDraft: {
              name: c.rawName,
              address: c.rawAddress,
              city: null,
              phone: c.rawPhone,
              website: c.rawWebsite,
              description: null,
              openingHours: [],
              latitude: c.rawCoords?.lat ?? null,
              longitude: c.rawCoords?.lon ?? null,
            },
          })
          .onConflictDoNothing({
            target: [
              osmCandidateWorkflowsTable.sourceName,
              osmCandidateWorkflowsTable.sourceId,
            ],
          });
      }
    }
    return count;
  });

  logger.info(
    {
      at: now.toISOString(),
      count: inserted,
      duplicatesSkipped: candidates.length - inserted,
    },
    "Stored external candidates (unpublished)"
  );
}