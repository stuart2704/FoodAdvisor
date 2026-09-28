import cron from "node-cron";
import { db, osmCandidateWorkflowsTable } from "@workspace/db";
import { and, asc, eq, gt, isNotNull, lte } from "drizzle-orm";
import { logger } from "../lib/logger";
import { AUTO_INVITE_REVIEW_DELAY_MS, OSM_SOURCE } from "../services/osmCandidateWorkflow";
import { sendOsmInvite } from "../services/osmInviteDelivery";

const SCHEDULE = "20 */3 * * *";
let task: ReturnType<typeof cron.schedule> | undefined;

export async function runOsmClaimInvites(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || process.env.OSM_CLAIM_AUTO_INVITES_ENABLED !== "true") return;
  // Keyset paging avoids reprocessing a permanently ineligible first page.
  let lastId = "";
  for (;;) {
    const rows = await db.select({ sourceId: osmCandidateWorkflowsTable.sourceId })
      .from(osmCandidateWorkflowsTable)
      .where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.autoInviteEnabled, true),
        eq(osmCandidateWorkflowsTable.reviewed, true),
        eq(osmCandidateWorkflowsTable.highConfidence, true),
        eq(osmCandidateWorkflowsTable.suppressed, false),
        eq(osmCandidateWorkflowsTable.published, false),
        eq(osmCandidateWorkflowsTable.claimed, false),
        eq(osmCandidateWorkflowsTable.outreachBlocked, false),
        isNotNull(osmCandidateWorkflowsTable.reviewedAt),
        lte(osmCandidateWorkflowsTable.reviewedAt, new Date(Date.now() - AUTO_INVITE_REVIEW_DELAY_MS)),
        ...(lastId ? [gt(osmCandidateWorkflowsTable.sourceId, lastId)] : []),
      ))
      .orderBy(asc(osmCandidateWorkflowsTable.sourceId)).limit(50);
    if (!rows.length) return;
    for (const row of rows) {
      lastId = row.sourceId;
      try {
        const result = await sendOsmInvite(row.sourceId, undefined, true);
        if (result.status !== "ineligible") {
          logger.info({ sourceId: row.sourceId, status: result.status }, "OSM automatic claim invitation outcome");
        }
      } catch (error) {
        logger.error({ err: error, sourceId: row.sourceId }, "OSM automatic claim invitation failed closed");
      }
    }
  }
}

export function startOsmClaimInviteScheduler() {
  if (task || process.env.NODE_ENV !== "production" || process.env.OSM_CLAIM_AUTO_INVITES_ENABLED !== "true") return task;
  task = cron.schedule(SCHEDULE, () => {
    void runOsmClaimInvites().catch((error) => logger.error({ err: error }, "OSM claim invitation cycle failed"));
  }, { noOverlap: true, name: "osm-claim-invites" });
  logger.info({ schedule: SCHEDULE }, "Opt-in OSM claim invitation scheduler started");
  return task;
}