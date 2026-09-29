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
  const result = await reserveCheck(placeId, options, "initial", clientPool);
  return typeof result === "number" ? "reserved" : result;
}

export async function reserveRefreshAmenityDetails(
  placeId: string, options: AmenityRunOptions, clientPool: Pick<typeof pool, "connect"> = pool,
): Promise<number | "duplicate" | "budget" | "quota"> {
  return reserveCheck(placeId, options, "refresh", clientPool);
}

async function reserveCheck(
  placeId: string, options: AmenityRunOptions, mode: "initial" | "refresh",
  clientPool: Pick<typeof pool, "connect">,
): Promise<number | "duplicate" | "budget" | "quota"> {
  validateAmenityRunOptions(options);
  if (!placeId || placeId.startsWith("osm:")) throw new Error("A Google Place ID is required.");
  const client = await clientPool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ monthly_budget_cents: number }>(
      "SELECT monthly_budget_cents FROM crawler_progress WHERE id = 1 FOR UPDATE",
    );
    if (state.rowCount !== 1) throw new Error("Shared Places budget row is missing.");
    const prior = await client.query<{
      id: number; status: string; completed_at: Date | null; mode: string;
      observed_amenities: string[] | null; review_decision: string | null;
    }>("SELECT id, status, completed_at, mode, observed_amenities, review_decision FROM place_amenity_checks WHERE place_id = $1 ORDER BY id DESC LIMIT 1", [placeId]);
    const latest = prior.rows[0];
    if ((mode === "initial" && latest) ||
        (mode === "refresh" && (!latest || latest.status !== "completed" ||
          (latest.mode === "refresh" && latest.observed_amenities !== null && !latest.review_decision) ||
          !latest.completed_at || Date.now() - new Date(latest.completed_at).getTime() < 90 * 86400_000))) {
      await client.query("COMMIT");
      return "duplicate";
    }
    const eligible = await client.query<{ amenities: string[] | null }>(`
      SELECT amenities FROM restaurants WHERE place_id = $1
        AND ($2 = 'refresh' OR amenities IS NULL) AND source_name = 'google'
        AND claim_status IS NULL AND claimed_at IS NULL FOR UPDATE
    `, [placeId, mode]);
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
    // Serialized by the shared crawler_progress lock, including across workers.
    const minute = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM place_amenity_checks WHERE created_at > now() - interval '1 minute'",
    );
    if (Number(minute.rows[0]?.count) >= options.providerMinuteQuota) {
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
    const check = await client.query<{ id: number }>(
      "INSERT INTO place_amenity_checks (place_id, status, reservation_id, mode, baseline_amenities) VALUES ($1, 'pending', $2, $3, $4) RETURNING id",
      [placeId, ledger.rows[0].id, mode, eligible.rows[0].amenities],
    );
    await client.query("COMMIT");
    return check.rows[0].id;
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
      UPDATE place_amenity_checks SET status = 'completed', completed_at = now(), observed_amenities = $2
      WHERE place_id = $1 AND status = 'pending' AND mode = 'initial' RETURNING id
    `, [placeId, amenities]);
    if (result.rowCount !== 1) throw new Error("Amenity reservation is not pending.");
    if (amenities !== null) {
      const applied = await client.query(`
        UPDATE restaurants SET amenities = $2
        WHERE place_id = $1 AND amenities IS NULL AND source_name = 'google'
          AND claim_status IS NULL AND claimed_at IS NULL
      `, [placeId, amenities]);
      if (applied.rowCount === 1) {
        await client.query("UPDATE place_amenity_checks SET applied_at = now() WHERE id = $1", [result.rows[0].id]);
      }
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
    "UPDATE place_amenity_checks SET status = 'failed', completed_at = now() WHERE place_id = $1 AND status = 'pending' AND mode = 'initial'",
    [placeId],
  );
}

export async function completeRefreshAmenityDetails(
  checkId: number, amenities: string[] | null, clientPool: Pick<typeof pool, "connect"> = pool,
): Promise<void> {
  const result = await clientPool.connect();
  try {
    const updated = await result.query(
      `UPDATE place_amenity_checks SET status = 'completed', completed_at = now(), observed_amenities = $2
       WHERE id = $1 AND status = 'pending' AND mode = 'refresh'`, [checkId, amenities],
    );
    if (updated.rowCount !== 1) throw new Error("Refresh reservation is not pending.");
  } finally { result.release(); }
}

export async function failRefreshAmenityDetails(checkId: number): Promise<void> {
  await pool.query(
    "UPDATE place_amenity_checks SET status = 'failed', completed_at = now() WHERE id = $1 AND status = 'pending' AND mode = 'refresh'",
    [checkId],
  );
}

/** A human must inspect the observed tags and explicitly accept or reject them.
 * The compare-and-swap also protects edits made while the request was in flight.
 * Historical checks have no proven applied baseline and cannot authorize replacing
 * an existing value. A conflicting review consumes the observation, not another call.
 */
export async function reviewRefreshAmenityDetails(
  checkId: number, reviewer: string, note: string, approve: boolean,
  clientPool: Pick<typeof pool, "connect"> = pool,
): Promise<"applied" | "rejected" | "conflict"> {
  if (!Number.isSafeInteger(checkId) || checkId < 1 || !reviewer.trim() || !note.trim()) {
    throw new Error("A check ID, reviewer and review note are required.");
  }
  const client = await clientPool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query<{
      place_id: string; observed_amenities: string[] | null; baseline_amenities: string[] | null;
    }>(`SELECT place_id, observed_amenities, baseline_amenities FROM place_amenity_checks
       WHERE id = $1 AND mode = 'refresh' AND status = 'completed'
         AND review_decision IS NULL FOR UPDATE`, [checkId]);
    if (check.rowCount !== 1 || check.rows[0].observed_amenities === null) {
      throw new Error("No reviewable refresh observation exists.");
    }
    const { place_id: placeId, observed_amenities: observed, baseline_amenities: baseline } = check.rows[0];
    let decision: "applied" | "rejected" | "conflict" = "rejected";
    if (approve) {
      // A null baseline is safe only if no prior checker-applied value exists:
      // an owner might have intentionally cleared that prior value.
      const priorApplied = await client.query<{ matches: boolean }>(`
        SELECT observed_amenities IS NOT DISTINCT FROM $3::text[] AS matches
        FROM place_amenity_checks WHERE place_id = $1 AND id < $2
          AND applied_at IS NOT NULL ORDER BY id DESC LIMIT 1
      `, [placeId, checkId, baseline]);
      const proven = priorApplied.rowCount
        ? priorApplied.rows[0].matches
        : baseline === null;
      if (proven) {
        const updated = await client.query(`
          UPDATE restaurants SET amenities = $2 WHERE place_id = $1
            AND source_name = 'google' AND claim_status IS NULL AND claimed_at IS NULL
            AND amenities IS NOT DISTINCT FROM $3::text[]
        `, [placeId, observed, baseline]);
        if (updated.rowCount === 1) decision = "applied";
      }
      if (decision !== "applied") decision = "conflict";
    }
    await client.query(`
      UPDATE place_amenity_checks SET reviewed_by = $2, review_note = $3,
        review_decision = $4, applied_at = CASE WHEN $4 = 'applied' THEN now() ELSE NULL END
      WHERE id = $1
    `, [checkId, reviewer.trim(), note.trim(), decision]);
    await client.query("COMMIT");
    return decision;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}