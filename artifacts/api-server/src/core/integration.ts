import {
  createImportPlan,
  getImportStatus,
  runImport,
} from "../lib/restaurant-import";
import { runDailyOutreach } from "../lib/outreach";
import { logEvent } from "../utils/eventLog";
import { db, restaurantsTable } from "@workspace/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { insertQueuedRestaurants } from "../pipeline/insertService";
import { generateOutreachFor } from "../outreach/messageGenerator";
import { getNewReplies, handleReply } from "../replies/replyService";
import { enrichRestaurant } from "../services/enrichment/enrichRestaurant";
import { generateDailySummary } from "../dashboard/metricsService";
import { applyScalingLimits, getScalingLimits, limitOutreach, limitReplies, type ScalingTier } from "../scaling/scalingService";

export interface DailyCycleOptions {
  // Internal, trusted caller only; this does not establish a paid entitlement.
  userTier?: ScalingTier;
  restaurantImport?: {
    cities: string[];
    perCityLimit?: number;
    monthlyBudgetCents?: number;
    // Without confirmation, generate a budget preview without paid requests.
    confirm?: boolean;
  };
  // The existing OUTREACH_ENABLED guard must also allow sending.
  sendOutreach?: boolean;
  drainInsertionQueue?: boolean;
  generateDrafts?: boolean;
  processStagedReplies?: boolean;
}

type ImportPlan = Awaited<ReturnType<typeof createImportPlan>>;
type ImportResult = Awaited<ReturnType<typeof runImport>>;
type OutreachResult = Awaited<ReturnType<typeof runDailyOutreach>>;

export interface DailyCycleResult {
  status: "completed" | "completed_with_errors";
  import: { status: "skipped" }
    | { status: "preview"; plan: ImportPlan }
    | {
        status: "completed";
        result: Omit<ImportResult, "restaurants">;
      };
  outreach: { status: "skipped"; reason: string }
    | { status: "completed"; result: OutreachResult };
  insertion: { status: "skipped" } | { status: "completed"; inserted: number };
  drafts: { status: "skipped" }
    | { status: "completed"; messages: Awaited<ReturnType<typeof generateOutreachFor>>[] };
  enrichment: { succeeded: number; failed: number; skipped: number };
  replies: { status: "handled_by_pubsub" }
    | { status: "completed"; processed: number; skipped: number; failed: number };
  summary: Awaited<ReturnType<typeof getImportStatus>>;
  dailySummary: string;
}

let running = false;

/**
 * Explicitly invoked orchestration only; importing this module starts no work.
 * A no-argument call reads a summary, but does not import or send email.
 * Existing services own insertion, enrichment, templates, deduplication, and
 * status transitions. Gmail replies continue through the durable push receiver.
 */
export async function runDailyCycle(
  options: DailyCycleOptions = {},
): Promise<DailyCycleResult> {
  if (running) throw new Error("A daily cycle is already running in this process.");
  const importOptions = options.restaurantImport;
  const limits = getScalingLimits(options.userTier);
  const budget = importOptions?.monthlyBudgetCents ?? 2500;
  if (importOptions && (!Number.isInteger(budget) || budget <= 0 || budget > 2500)) {
    throw new Error("Monthly import budget must be between 1 and 2500 pence.");
  }
  if (options.sendOutreach === true && process.env.OUTREACH_ENABLED !== "true") {
    throw new Error("Outreach sending is disabled.");
  }

  running = true;
  let phase = "initialisation";
  logEvent("info", "Daily cycle started");
  try {
    const enrichment = { succeeded: 0, failed: 0, skipped: 0 };
    let imported: DailyCycleResult["import"] = { status: "skipped" };
    if (importOptions) {
      phase = "restaurant import";
      const requestedPerCity = importOptions.perCityLimit ?? 10;
      if (!Number.isInteger(requestedPerCity) || requestedPerCity < 1) {
        throw new Error("Per-city limit must be a positive integer.");
      }
      const input = {
        cities: applyScalingLimits(importOptions.cities, options.userTier),
        perCityLimit: Math.min(requestedPerCity, limits.MAX_RESTAURANTS_PER_CITY),
        monthlyBudgetCents: budget,
      };
      if (importOptions.confirm === true) {
        logEvent("info", "Restaurant import and insertion started");
        const result = await runImport({ ...input, confirm: true });
        // Return operational counts, not restaurant contact records.
        const { restaurants: _restaurants, ...counts } = result;
        imported = { status: "completed", result: counts };
        logEvent("success", `Restaurant import completed: ${result.imported} inserted`);
        phase = "website enrichment";
        for (const restaurant of result.restaurants) {
          if (!restaurant.website) {
            enrichment.skipped += 1;
            continue;
          }
          try {
            const enriched = await enrichRestaurant(restaurant.id);
            if (enriched.ok) enrichment.succeeded += 1;
            else enrichment.failed += 1;
          } catch {
            enrichment.failed += 1;
          }
        }
        logEvent(enrichment.failed ? "warning" : "info",
          `Website enrichment finished: ${enrichment.succeeded} succeeded, ${enrichment.failed} failed`);
      } else {
        imported = { status: "preview", plan: await createImportPlan(input) };
        logEvent("info", "Import preview generated; no paid requests made");
      }
    } else {
      logEvent("info", "Restaurant import skipped: no cities requested");
    }

    let insertion: DailyCycleResult["insertion"] = { status: "skipped" };
    if (options.drainInsertionQueue === true) {
      phase = "queued insertion";
      const inserted = await insertQueuedRestaurants();
      insertion = { status: "completed", inserted: inserted.length };
      // Inserts already receive pending status. Never reset existing records.
    }

    let drafts: DailyCycleResult["drafts"] = { status: "skipped" };
    if (options.generateDrafts === true) {
      phase = "outreach draft generation";
      const candidates = await db.select().from(restaurantsTable).where(and(
        isNull(restaurantsTable.suppressedAt),
        isNull(restaurantsTable.claimedAt),
        eq(restaurantsTable.outreachCount, 0),
        eq(restaurantsTable.outreachStatus, "pending"),
        or(isNull(restaurantsTable.nextOutreachAfter),
          lte(restaurantsTable.nextOutreachAfter, new Date())),
      )).orderBy(restaurantsTable.importedAt).limit(limits.MAX_OUTREACH_PER_DAY);
      const messages = [];
      for (const restaurant of limitOutreach(candidates)) {
        messages.push(await generateOutreachFor({
          placeId: restaurant.placeId,
          name: restaurant.name,
          city: restaurant.city,
          cuisine: restaurant.cuisineTags[0],
          website: restaurant.website,
          rating: restaurant.rating,
        }));
      }
      // Preview drafts only; the guarded sender owns final dispatch content.
      drafts = { status: "completed", messages };
      logEvent("info", `Outreach drafts generated: ${messages.length}`);
    }

    let outreach: DailyCycleResult["outreach"] = {
      status: "skipped",
      reason: "Sending was not explicitly requested.",
    };
    if (options.sendOutreach === true) {
      phase = "outreach";
      logEvent("info", "Outreach enrichment, generation, and sending started");
      const result = await runDailyOutreach();
      outreach = { status: "completed", result };
      logEvent(
        result.failed > 0 ? "warning" : "success",
        `Outreach run finished: ${result.sent} sent, ${result.failed} failed`,
      );
    } else {
      logEvent("info", "Outreach sending skipped: not explicitly requested");
    }

    let replies: DailyCycleResult["replies"] = { status: "handled_by_pubsub" };
    if (options.processStagedReplies === true) {
      phase = "staged reply processing";
      const pending = limitReplies(await getNewReplies());
      replies = { status: "completed", processed: 0, skipped: 0, failed: 0 };
      for (const reply of pending) {
        try {
          const result = await handleReply(reply);
          if (result.status === "processed") replies.processed += 1;
          else replies.skipped += 1;
        } catch {
          replies.failed += 1;
        }
      }
      logEvent(replies.failed ? "warning" : "info",
        `Staged reply processing finished: ${replies.processed} processed, ${replies.failed} failed`);
    }
    phase = "summary";
    const [summary, dailySummary] = await Promise.all([
      getImportStatus(),
      generateDailySummary(),
    ]);
    const status = (outreach.status === "completed" && outreach.result.failed > 0)
      || enrichment.failed > 0 || (replies.status === "completed" && replies.failed > 0)
      ? "completed_with_errors" : "completed";
    logEvent("info", "Replies and their status updates remain handled by Gmail Pub/Sub");
    logEvent(status === "completed" ? "success" : "warning",
      status === "completed" ? "Daily cycle completed" : "Daily cycle completed with errors");
    return { status, import: imported, insertion, enrichment, drafts, outreach, replies, summary, dailySummary };
  } catch {
    // Never publish raw provider errors or report success after a failed phase.
    logEvent("error", `Daily cycle failed during ${phase}`);
    throw new Error(`Daily cycle failed during ${phase}; inspect server diagnostics before retrying.`);
  } finally {
    running = false;
  }
}