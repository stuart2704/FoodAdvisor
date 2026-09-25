import { db, externalCandidatesTable } from "@workspace/db";
import type { ExternalCandidate } from "./candidateTypes";
import { logger } from "../lib/logger";

/**
 * Store external candidates as UNVERIFIED.
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
          verificationStatus: "unverified",
        })
        .onConflictDoNothing({
          target: [externalCandidatesTable.sourceName, externalCandidatesTable.sourceId],
        })
        .returning({ sourceId: externalCandidatesTable.sourceId });
      count += rows.length;
    }
    return count;
  });

  logger.info(
    {
      at: now.toISOString(),
      count: inserted,
      duplicatesSkipped: candidates.length - inserted,
    },
    "Stored external candidates (UNVERIFIED)"
  );
}