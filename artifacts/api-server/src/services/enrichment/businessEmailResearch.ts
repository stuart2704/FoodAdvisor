import { createHash } from "node:crypto";
import {
  db,
  outreachAuditTable,
  pool,
  restaurantsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { extractWebsiteData } from "./extractWebsiteData";
import { classifyBusinessEmailResearch } from "./businessEmailResearchRules";
import { logger } from "../../lib/logger";

export type ResearchStatus = "no_business_email" | "extraction_failed";

export type BusinessEmailCheckResult = {
  status: string;
  emailFound: boolean;
  checkedAt: Date | null;
  reason: string | null;
  outcome: "checked" | "skipped" | "busy";
  enrichment: "succeeded" | "failed" | "skipped";
  busy?: boolean;
};

const researchStatuses = ["no_business_email", "extraction_failed"] as const;
const checkableStatuses = ["pending", ...researchStatuses] as const;
const activeDeliveryEvents = ["send_attempt", "sent"] as const;
const FAILURE_REASON = "Website extraction failed unexpectedly.";

function advisoryKey(placeId: string): [number, number] {
  const digest = createHash("sha256").update(placeId).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

/**
 * Checks only the restaurant website. A session advisory lock spans the
 * network request so another API worker cannot perform the same check.
 */
export async function checkBusinessEmailFromWebsite(
  placeId: string,
  options: { requireResearchStatus?: boolean } = {},
): Promise<BusinessEmailCheckResult | null> {
  const client = await pool.connect();
  const [key1, key2] = advisoryKey(placeId);
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1, $2) as locked",
      [key1, key2],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      const [current] = await db
        .select({
          status: restaurantsTable.outreachStatus,
          checkedAt: restaurantsTable.enrichedAt,
          reason: restaurantsTable.outreachFailure,
          email: restaurantsTable.publicBusinessEmail,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, placeId))
        .limit(1);
      return current
        ? {
            status: current.status,
            emailFound: current.email !== null,
            checkedAt: current.checkedAt,
            reason: current.reason,
            outcome: "busy",
            enrichment: "skipped",
            busy: true,
          }
        : null;
    }

    const [restaurant] = await db
      .select()
      .from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId))
      .limit(1);
    if (!restaurant) return null;

    if (options.requireResearchStatus && !isResearchStatus(restaurant.outreachStatus)) {
      return {
        status: restaurant.outreachStatus,
        emailFound: restaurant.publicBusinessEmail !== null,
        checkedAt: restaurant.enrichedAt,
        reason: restaurant.outreachFailure,
        outcome: "skipped",
        enrichment: "skipped",
      };
    }

    // Do not enrich or change records whose outreach lifecycle has advanced.
    if (
      !checkableStatuses.includes(restaurant.outreachStatus as typeof checkableStatuses[number]) ||
      restaurant.outreachCount !== 0 ||
      restaurant.suppressedAt ||
      restaurant.claimedAt ||
      restaurant.claimStatus ||
      restaurant.claimAttemptId
    ) {
      return {
        status: restaurant.outreachStatus,
        emailFound: restaurant.publicBusinessEmail !== null,
        checkedAt: restaurant.enrichedAt,
        reason: restaurant.outreachFailure,
        outcome: "skipped",
        enrichment: "skipped",
      };
    }

    const [activeDelivery] = await db
      .select({ id: outreachAuditTable.id })
      .from(outreachAuditTable)
      .where(and(
        eq(outreachAuditTable.placeId, placeId),
        inArray(outreachAuditTable.event, [...activeDeliveryEvents]),
      ))
      .limit(1);
    if (activeDelivery) {
      return {
        status: restaurant.outreachStatus,
        emailFound: restaurant.publicBusinessEmail !== null,
        checkedAt: restaurant.enrichedAt,
        reason: restaurant.outreachFailure,
        outcome: "skipped",
        enrichment: "skipped",
      };
    }

    const checkedAt = new Date();
    let classification;
    if (!restaurant.website) {
      classification = classifyBusinessEmailResearch({
        websitePresent: false,
        extractionSucceeded: false,
      });
    } else {
      try {
        const extracted = await extractWebsiteData(restaurant.website);
        if (!extracted.ok) {
          classification = classifyBusinessEmailResearch({
            websitePresent: true,
            extractionSucceeded: false,
            extractionError: extracted.error.message,
          });
        } else {
          classification = classifyBusinessEmailResearch({
            websitePresent: true,
            extractionSucceeded: true,
            email: extracted.data.roleEmail,
            emailSourceUrl: extracted.data.finalUrl,
          });
        }
      } catch {
        classification = classifyBusinessEmailResearch({
          websitePresent: true,
          extractionSucceeded: false,
        });
      }
    }
    const {
      status,
      reason,
      email,
      emailSourceUrl,
      auditEvent,
      extractionSucceeded,
    } = classification;

    let updated = false;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(restaurantsTable)
        .set({
          outreachStatus: status,
          outreachFailure: reason,
          enrichedAt: checkedAt,
          enrichmentStatus: extractionSucceeded ? "succeeded" : "failed",
          enrichmentFailure: extractionSucceeded ? null : reason,
          ...(email
            ? {
                publicBusinessEmail: email,
                emailSourceUrl,
                emailDiscoveredAt: checkedAt,
              }
            : {}),
        })
        .where(and(
          eq(restaurantsTable.placeId, placeId),
          inArray(restaurantsTable.outreachStatus, [...checkableStatuses]),
          eq(restaurantsTable.outreachCount, 0),
          isNull(restaurantsTable.suppressedAt),
          isNull(restaurantsTable.claimedAt),
          isNull(restaurantsTable.claimStatus),
          isNull(restaurantsTable.claimAttemptId),
          sql`not exists (
            select 1 from ${outreachAuditTable}
            where ${outreachAuditTable.placeId} = ${restaurantsTable.placeId}
              and ${outreachAuditTable.event} in ('send_attempt', 'sent')
          )`,
        ))
        .returning({ placeId: restaurantsTable.placeId });
      if (!row) return;
      updated = true;
      await tx.insert(outreachAuditTable).values({
        placeId,
        event: auditEvent,
        recipientDomain: email?.split("@")[1],
        detail: reason,
      });
    });

    if (!updated) {
      const [current] = await db
        .select({
          status: restaurantsTable.outreachStatus,
          checkedAt: restaurantsTable.enrichedAt,
          reason: restaurantsTable.outreachFailure,
          email: restaurantsTable.publicBusinessEmail,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, placeId))
        .limit(1);
      return current
        ? {
            status: current.status,
            emailFound: current.email !== null,
            checkedAt: current.checkedAt,
            reason: current.reason,
            outcome: "skipped",
            enrichment: "skipped",
          }
        : null;
    }

    return {
      status,
      emailFound: !!email,
      checkedAt,
      reason,
      outcome: "checked",
      enrichment: !restaurant.website
        ? "skipped"
        : extractionSucceeded ? "succeeded" : "failed",
    };
  } finally {
    if (locked) {
      try {
        await client.query("select pg_advisory_unlock($1, $2)", [key1, key2]);
      } catch (error) {
        logger.error({ err: error, placeId }, "Business email research lock release failed");
      }
    }
    try {
      client.release();
    } catch (error) {
      logger.error({ err: error, placeId }, "Business email research connection release failed");
    }
  }
}

/**
 * Paid import paths use this non-throwing boundary so a website failure can
 * never turn a completed paid Places reservation into an ambiguous retry.
 */
export async function runBusinessEmailResearch(
  placeId: string,
): Promise<BusinessEmailCheckResult> {
  try {
    const result = await checkBusinessEmailFromWebsite(placeId);
    return result ?? {
      status: "extraction_failed",
      emailFound: false,
      checkedAt: null,
      reason: FAILURE_REASON,
      outcome: "skipped",
      enrichment: "skipped",
    };
  } catch (error) {
    const { checkedAt, updated } = await recordBusinessEmailResearchFailure(placeId, error);
    return {
      status: "extraction_failed",
      emailFound: false,
      checkedAt,
      reason: FAILURE_REASON,
      outcome: updated ? "checked" : "skipped",
      enrichment: updated ? "failed" : "skipped",
    };
  }
}

export async function recordBusinessEmailResearchFailure(
  placeId: string,
  error: unknown,
): Promise<{ checkedAt: Date; updated: boolean }> {
  logger.error({ err: error, placeId }, "Business email website check failed");
  const checkedAt = new Date();
  try {
    let updated = false;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(restaurantsTable)
        .set({
          outreachStatus: "extraction_failed",
          outreachFailure: FAILURE_REASON,
          enrichedAt: checkedAt,
          enrichmentStatus: "failed",
          enrichmentFailure: FAILURE_REASON,
        })
        .where(and(
          eq(restaurantsTable.placeId, placeId),
          inArray(restaurantsTable.outreachStatus, [...checkableStatuses]),
          eq(restaurantsTable.outreachCount, 0),
          isNull(restaurantsTable.suppressedAt),
          isNull(restaurantsTable.claimedAt),
          isNull(restaurantsTable.claimStatus),
          isNull(restaurantsTable.claimAttemptId),
          sql`not exists (
            select 1 from ${outreachAuditTable}
            where ${outreachAuditTable.placeId} = ${restaurantsTable.placeId}
              and ${outreachAuditTable.event} in ('send_attempt', 'sent')
          )`,
        ))
        .returning({ placeId: restaurantsTable.placeId });
      if (!row) return;
      updated = true;
      await tx.insert(outreachAuditTable).values({
        placeId,
        event: "extraction_failed",
        detail: FAILURE_REASON,
      });
    });
    return { checkedAt, updated };
  } catch (persistenceError) {
    logger.error(
      { err: persistenceError, placeId },
      "Could not persist business email extraction failure",
    );
    return { checkedAt, updated: false };
  }
}

export function isResearchStatus(status: string): status is ResearchStatus {
  return researchStatuses.includes(status as ResearchStatus);
}