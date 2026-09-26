/**
 * Manual, opt-in Place Details enrichment. Never scheduled. Before running, set
 * a provider-side Place Details (New) per-minute quota on the dedicated project
 * and verify billing alerts. An operator attests to that quota at invocation;
 * the application cannot inspect or enforce the Google Cloud quota itself.
 *
 * pnpm --filter api-server exec tsx src/scripts/enrichPlaceAmenities.ts \
 *   --confirm --provider-quota-confirmed --provider-minute-quota 1 --daily-limit 10 \
 *   --max-requests 5 --estimated-request-cents 80 --monthly-budget-cents 3000
 *
 * Choose estimated-request-cents conservatively from the current Place Details
 * Enterprise + Atmosphere SKU in your billing currency; this is NOT an invoice cap.
 * Pending/failed attempts retain their charge and are skipped on restart.
 */
import { pool } from "@workspace/db";
import { fetchPlaceAmenities } from "../lib/placeAmenities";
import {
  completeAmenityDetails, failAmenityDetails, reserveAmenityDetails,
  validateAmenityRunOptions, type AmenityRunOptions,
} from "../lib/placeAmenityReservations";
import { logEvent } from "../lib/logEvent";
import { logger } from "../lib/logger";

function parseOptions(args: string[]): AmenityRunOptions {
  const read = (flag: string): number => {
    const index = args.indexOf(flag);
    if (index < 0 || index + 1 === args.length) throw new Error(`${flag} is required.`);
    return Number(args[index + 1]);
  };
  if (!args.includes("--confirm") || !args.includes("--provider-quota-confirmed")) {
    throw new Error("Explicit --confirm and --provider-quota-confirmed are required; configure the quota in Google Cloud first.");
  }
  const options = {
    dailyLimit: read("--daily-limit"),
    providerMinuteQuota: read("--provider-minute-quota"),
    maxRequests: read("--max-requests"),
    estimatedRequestCents: read("--estimated-request-cents"),
    monthlyBudgetCents: read("--monthly-budget-cents"),
  };
  validateAmenityRunOptions(options);
  return options;
}

export async function runAmenityEnrichment(args: string[]) {
  const options = parseOptions(args);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is required; no Place Details request was made.");
  // Select more than the run allowance so previously attempted rows never
  // prevent progress. Each claim is independently rechecked under a DB lock.
  const candidates = await pool.query<{ place_id: string }>(`
    SELECT r.place_id FROM restaurants r
    WHERE r.amenities IS NULL AND r.source_name = 'google'
      AND r.claim_status IS NULL AND r.claimed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM place_amenity_checks c WHERE c.place_id = r.place_id)
    ORDER BY r.place_id LIMIT $1
  `, [options.maxRequests]);
  let attempted = 0;
  for (const { place_id: placeId } of candidates.rows) {
    if (attempted > 0) {
      await new Promise((done) => setTimeout(done, Math.ceil(60_000 / options.providerMinuteQuota)));
    }
    const reservation = await reserveAmenityDetails(placeId, options);
    if (reservation === "duplicate") continue;
    if (reservation !== "reserved") {
      logEvent("amenity_enrichment_stopped", { reason: reservation, attempted });
      break;
    }
    attempted++;
    logEvent("amenity_details_reserved", { place_id: placeId, estimated_cost_cents: options.estimatedRequestCents });
    try {
      const amenities = await fetchPlaceAmenities(placeId, apiKey);
      await completeAmenityDetails(placeId, amenities);
      logEvent("amenity_details_completed", { place_id: placeId, known: amenities !== null });
    } catch (error) {
      // Even a timeout or 429 may have been billed. Keep the reservation and
      // mark it failed; if marking fails, pending is also non-retryable.
      try { await failAmenityDetails(placeId); } catch (markError) {
        logger.error({ err: markError }, "Could not record failed Place Details attempt");
      }
      throw error;
    }
  }
  logEvent("amenity_enrichment_summary", { attempted, candidates: candidates.rows.length });
}

if (process.argv[1]?.endsWith("/enrichPlaceAmenities.ts")) {
  runAmenityEnrichment(process.argv.slice(2)).catch((error: unknown) => {
    logger.error({ err: error }, "Amenity enrichment stopped");
    process.exitCode = 1;
  }).finally(() => pool.end());
}