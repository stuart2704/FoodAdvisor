import { logger } from "../lib/logger";
import {
  dbInsertRestaurant,
  type InsertedRestaurant,
} from "../pipeline/neonClient";
import { recordHeartbeat } from "../services/engineHeartbeat";
import outreachEngine from "./outreachEngine";

export interface RestaurantDiscoveryOptions {
  fetchNewRestaurants: () => Promise<unknown[]>;
  enrichRestaurants?: (restaurants: unknown[]) => Promise<unknown[]>;
}

export interface RestaurantDiscoveryResult {
  fetched: number;
  enriched: number;
  inserted: number;
}

/**
 * Discovers and persists restaurants from an explicitly supplied source.
 *
 * The source is injected so scheduled callers must choose a real, budget-aware
 * provider instead of silently writing mocked restaurants. The existing
 * database insertion pipeline owns validation, canonical slugs, regions, and
 * duplicate protection.
 */
export async function restaurantDiscoveryEngine(
  options: RestaurantDiscoveryOptions,
): Promise<RestaurantDiscoveryResult> {
  logger.info("Starting restaurant discovery engine");

  try {
    const newRestaurants = await options.fetchNewRestaurants();
    if (!Array.isArray(newRestaurants)) {
      throw new Error("The restaurant discovery source must return an array.");
    }
    logger.info(
      { fetched: newRestaurants.length },
      "Restaurant discovery source completed",
    );

    const enriched = options.enrichRestaurants
      ? await options.enrichRestaurants(newRestaurants)
      : newRestaurants;
    if (!Array.isArray(enriched)) {
      throw new Error("The restaurant enrichment step must return an array.");
    }
    logger.info(
      { enriched: enriched.length },
      "Restaurant discovery enrichment completed",
    );

    const inserted: InsertedRestaurant[] = [];
    for (const restaurant of enriched) {
      const created = await dbInsertRestaurant(restaurant);
      if (created) inserted.push(created);
    }
    logger.info(
      { inserted: inserted.length },
      "Restaurant discovery persistence completed",
    );

    // outreachEngine already runs the integrated daily automation cycle. Calling
    // runDailyCycle separately here would risk processing outreach twice.
    const automation = await outreachEngine();
    if (!automation.success) {
      throw new Error("The discovery automation cycle reported failures.");
    }

    await recordHeartbeat("discovery");
    logger.info("Restaurant discovery engine completed");

    return {
      fetched: newRestaurants.length,
      enriched: enriched.length,
      inserted: inserted.length,
    };
  } catch (error) {
    logger.error({ err: error }, "Restaurant discovery engine failed");
    throw error;
  }
}

export default restaurantDiscoveryEngine;