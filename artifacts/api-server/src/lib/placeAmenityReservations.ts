import { pool } from "@workspace/db";
import { ESTIMATED_GRID_REQUEST_COST_CENTS, paidPlacesBudgetReached } from "./gridCrawlPlan";

export type AmenityRunOptions = {
  monthlyBudgetCents: number;
  estimatedRequestCents: number;
  dailyLimit: number;
  providerMinuteQuota: number;
  maxRequests: number;
};

export function validateAmenityRunOptions(options: AmenityRunOptions): void {
  const { monthlyBudgetCents, estimatedRequestCents, dailyLimit, providerMinuteQuota, maxRequests } = options;
  if (![monthlyBudgetCents, estimatedRequestCents, dailyLimit, providerMinuteQuota, maxRequests].every(Number.isSafeInteger) ||
      monthlyBudgetCents < ESTIMATED_GRID_REQUEST_COST_CENTS || monthlyBudgetCents > 3000 ||
      estimatedRequestCents < ESTIMATED_GRID_REQUEST_COST_CENTS || estimatedRequestCents > monthlyBudgetCents ||
      dailyLimit < 1 || dailyLimit > 50 ||
      providerMinuteQuota < 1 || providerMinuteQuota > 10 ||
      maxRequests < 1 || maxRequests > dailyLimit) {
    throw new Error("Invalid amenities budget, estimated per-request cost, daily limit, provider minute quota or run limit.");
  }
}

/** Atomically claim this venue and charge the shared Places ledger BEFORE the HTTP call. */
export async function reserveAmenityDetails(
  placeId: string, options: AmenityRunOptions, clientPool: Pick<typeof pool, "connect"> = pool,
): Promise<"reserved" | "duplicate" | "budget" | "quota"> {
  validateAmenityRunOptions(options);
  if (!placeId || placeId.startsWith("osm:")) throw new Error("A Google Place ID is required.");
  const client = await clientPool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ monthly_budget_cents: number }>(
      "SELECT monthly_budget_cents FROM crawler_progress WHERE id = 1 FOR UPDATE",
    );
    if (state.rowCount !== 1) throw new Error("Shared Places budget row is missing.");
    const prior = await client.query("SELECT 1 FROM place_amenity_checks WHERE place_id = $1", [placeId]);
    if (prior.rowCount) {
      await client.query("COMMIT");
      return "duplicate";
    }
    const eligible = await client.query(`
      SELECT 1 FROM restaurants WHERE place_id = $1
        AND amenities IS NULL AND source_name = 'google'
        AND claim_status IS NULL AND claimed_at IS NULL FOR UPDATE
    `, [placeId]);
    if (eligible.rowCount !== 1) {
      await client.query("COMMIT");
      return "duplicate";
    }
    const daily = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM place_amenity_checks WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
    );
    if (Number(daily.rows[0]?.count) >= options.dailyLimit) {
      await client.query("COMMIT");
      return "quota";
    }
    const month = new Date().toISOString().slice(0, 7);
    const usage = await client.query<{ spent: string; calls: string }>(`
      SELECT coalesce(sum(estimated_cost_cents), 0)::text AS spent,
             coalesce(sum(api_calls), 0)::text AS calls
      FROM restaurant_import_runs WHERE created_at >= $1::timestamptz
    `, [`${month}-01T00:00:00Z`]);
    if (paidPlacesBudgetReached(
      Number(usage.rows[0]?.spent), Number(usage.rows[0]?.calls),
      options.estimatedRequestCents, Math.min(options.monthlyBudgetCents, state.rows[0].monthly_budget_cents),
    )) {
      await client.query("COMMIT");
      return "budget";
    }
    const ledger = await client.query<{ id: number }>(`
      INSERT INTO restaurant_import_runs
        (cities, requested, imported, skipped_duplicates, api_calls, estimated_cost_cents,
         monthly_budget_cents, stopped_because)
      VALUES (ARRAY['Place Details amenities'], 1, 0, 0, 1, $1, $2, 'Place Details amenities reserved')
      RETURNING id
    `, [options.estimatedRequestCents, Math.min(options.monthlyBudgetCents, state.rows[0].monthly_budget_cents)]);
    await client.query(
      "INSERT INTO place_amenity_checks (place_id, status, reservation_id) VALUES ($1, 'pending', $2)",
      [placeId, ledger.rows[0].id],
    );
    await client.query("COMMIT");
    return "reserved";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Do not update owner or claim fields; never replace existing amenities. */
export async function completeAmenityDetails(
  placeId: string, amenities: string[] | null, clientPool: Pick<typeof pool, "connect"> = pool,
): Promise<void> {
  const client = await clientPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      UPDATE place_amenity_checks SET status = 'completed', completed_at = now()
      WHERE place_id = $1 AND status = 'pending' RETURNING place_id
    `, [placeId]);
    if (result.rowCount !== 1) throw new Error("Amenity reservation is not pending.");
    if (amenities !== null) {
      await client.query(`
        UPDATE restaurants SET amenities = $2
        WHERE place_id = $1 AND amenities IS NULL AND source_name = 'google'
          AND claim_status IS NULL AND claimed_at IS NULL
      `, [placeId, amenities]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failAmenityDetails(placeId: string): Promise<void> {
  await pool.query(
    "UPDATE place_amenity_checks SET status = 'failed', completed_at = now() WHERE place_id = $1 AND status = 'pending'",
    [placeId],
  );
}