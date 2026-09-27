import { pool } from "@workspace/db";
import {
  DAILY_GRID_LIMIT, ESTIMATED_GRID_REQUEST_COST_CENTS, MONTHLY_PAID_LIMIT,
  paidGridBudgetReached, paidPlacesBudgetReached, type GridPoint,
} from "./gridCrawlPlan";

export type RegionAllocation = {
  budget: number;
  interval: number;
  cities: Record<string, number>;
};
export type GridAllocations = Record<string, RegionAllocation>;

type State = {
  grid_hash: string | null;
  next_index: number;
  pending_index: number | null;
  last_run_date: string;
  attempt_date: string;
  attempted_today: number;
  automation_enabled: boolean;
  monthly_budget_cents: number;
};

export function regionKey(point: GridPoint): string {
  return point.globalRegion.toLowerCase().replace(/\s+/g, "_");
}

export function isTerminalRegionPoint(points: readonly GridPoint[], index: number): boolean {
  if (!Number.isSafeInteger(index) || index < 0 || index >= points.length) {
    throw new Error("Invalid grid point index.");
  }
  return index + 1 === points.length || regionKey(points[index + 1]) !== regionKey(points[index]);
}

export function exhaustedAllocationTransition(
  kind: "region" | "city", nextCityIndex: number, nextRegionIndex: number, gridLength: number,
): { nextIndex: number; resumeAt: number; closeRegion: boolean } {
  const resumeAt = kind === "region" ? nextRegionIndex : nextCityIndex;
  if (!Number.isSafeInteger(resumeAt) || resumeAt < 0 || resumeAt > gridLength ||
      !Number.isSafeInteger(nextRegionIndex) || nextRegionIndex < resumeAt || nextRegionIndex > gridLength) {
    throw new Error("Invalid next city or region boundary.");
  }
  return { nextIndex: resumeAt,
    resumeAt, closeRegion: kind === "region" || resumeAt === nextRegionIndex };
}

const todayUTC = () => new Date().toISOString().slice(0, 10);
const monthUTC = (date: string) => `${date.slice(0, 7)}-01`;

/** A transaction lock survives transaction-pooling proxies for the whole crawl. */
export async function withGridCrawlLock<T>(run: () => Promise<T>, database: Pick<typeof pool, "connect"> = pool): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1, $2) AS locked", [19067, 2026],
    );
    if (result.rows[0]?.locked !== true) throw new Error("Another grid crawl is running; no paid request was made.");
    const value = await run();
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getGridRuntimeState(): Promise<State> {
  const result = await pool.query<State>(`
    SELECT grid_hash, next_index, pending_index,
           (last_run AT TIME ZONE 'UTC')::date::text AS last_run_date,
           attempt_date::text AS attempt_date,
           attempted_today, automation_enabled, monthly_budget_cents
    FROM crawler_progress WHERE id = 1
  `);
  if (result.rows.length !== 1) throw new Error("Crawler progress row is missing.");
  return result.rows[0];
}

export async function pauseGridAutomation(): Promise<void> {
  const result = await pool.query(
    "UPDATE crawler_progress SET automation_enabled = FALSE WHERE id = 1 RETURNING id",
  );
  if (result.rowCount !== 1) throw new Error("Crawler progress row is missing.");
}

/** Reserve before every non-grid Places request, under the same lock as the grid. */
export async function reservePaidPlacesCall(input: {
  label: string;
  requested: number;
  costCents: number;
  monthlyBudgetCents: number;
}): Promise<number | null> {
  const { label, requested, monthlyBudgetCents } = input;
  const costCents = Math.max(input.costCents, ESTIMATED_GRID_REQUEST_COST_CENTS);
  if (!label.trim() || !Number.isSafeInteger(requested) || requested < 1 ||
      !Number.isSafeInteger(input.costCents) || input.costCents < 1 ||
      !Number.isSafeInteger(monthlyBudgetCents) || monthlyBudgetCents < ESTIMATED_GRID_REQUEST_COST_CENTS ||
      monthlyBudgetCents > MONTHLY_PAID_LIMIT * ESTIMATED_GRID_REQUEST_COST_CENTS) {
    throw new Error("Invalid Places request or monthly budget; no request was reserved.");
  }
  const month = monthUTC(todayUTC());
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ monthly_budget_cents: number }>(
      "SELECT monthly_budget_cents FROM crawler_progress WHERE id = 1 FOR UPDATE",
    );
    if (state.rowCount !== 1) throw new Error("Shared paid-request lock row is missing.");
    const effectiveBudget = Math.min(monthlyBudgetCents, state.rows[0].monthly_budget_cents);
    const usage = await client.query<{ spent: string; calls: string }>(`
      SELECT coalesce(sum(estimated_cost_cents), 0)::text AS spent,
             coalesce(sum(api_calls), 0)::text AS calls
      FROM restaurant_import_runs WHERE created_at >= $1::timestamptz
    `, [`${month}T00:00:00Z`]);
    const spent = Number(usage.rows[0].spent);
    const calls = Number(usage.rows[0].calls);
    if (paidPlacesBudgetReached(spent, calls, costCents, effectiveBudget)) {
      await client.query("COMMIT");
      return null;
    }
    const entry = await client.query<{ id: number }>(`
      INSERT INTO restaurant_import_runs
        (cities, requested, imported, skipped_duplicates, api_calls, estimated_cost_cents,
         monthly_budget_cents, stopped_because)
      VALUES ($1, $2, 0, 0, 1, $3, $4, $5) RETURNING id
    `, [[label], requested, costCents, effectiveBudget, `Places request reserved: ${label}`]);
    if (!Number.isSafeInteger(entry.rows[0]?.id)) throw new Error("Places import ledger reservation failed.");
    await client.query("COMMIT");
    return entry.rows[0].id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reservePaidSearchTextCall(input: {
  city: string;
  requested: number;
  costCents: number;
  monthlyBudgetCents: number;
}): Promise<number | null> {
  return reservePaidPlacesCall({
    label: `Search Text for ${input.city}`,
    requested: input.requested,
    costCents: input.costCents,
    monthlyBudgetCents: input.monthlyBudgetCents,
  });
}

export type ReservationResult =
  | { status: "reserved"; usedRequests: number; spentCents: number; attemptedToday: number;
      cityBudget: number; cityUsed: number; regionBudget: number; regionUsed: number }
  | { status: "region" | "city"; attemptedToday: number; budget: number; used: number; nextIndex: number }
  | { status: "not_due" | "daily" | "monthly" | "disabled"; attemptedToday: number };

/**
 * One transaction owns the global ledger entry, city and region counters, and
 * pending point. Commit BEFORE contacting Google; never refund uncertain calls.
 */
export async function reserveGridPoint(
  hash: string,
  pointIndex: number,
  point: GridPoint,
  nextCityIndex: number,
  nextRegionIndex: number,
  gridLength: number,
  allocations: GridAllocations,
  monthlyBudgetCents: number,
  auto: boolean,
  simulate = false,
  database: Pick<typeof pool, "connect"> = pool,
): Promise<ReservationResult> {
  const client = await database.connect();
  const date = todayUTC();
  const month = monthUTC(date);
  try {
    await client.query("BEGIN");
    const finish = () => client.query(simulate ? "ROLLBACK" : "COMMIT");
    const result = await client.query<State>(`
      SELECT grid_hash, next_index, pending_index, attempt_date::text AS attempt_date,
             attempted_today, automation_enabled, monthly_budget_cents
      FROM crawler_progress WHERE id = 1 FOR UPDATE
    `);
    if (result.rows.length !== 1) throw new Error("Crawler progress row is missing.");
    const state = result.rows[0];
    if (auto && !state.automation_enabled) {
      await finish();
      return { status: "disabled", attemptedToday: state.attempted_today };
    }
    if (state.grid_hash && state.grid_hash !== hash) {
      throw new Error("Grid changed after paid work; inspect reservations before changing the grid.");
    }
    if (state.pending_index !== null) {
      throw new Error(`Point ${state.pending_index} has an uncertain paid reservation; inspect it before resuming.`);
    }
    if (state.next_index !== pointIndex) throw new Error("Crawler cursor changed; stop instead of repeating a point.");
    if (state.grid_hash === null) {
      const previous = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM restaurant_import_runs WHERE stopped_because LIKE 'Grid request reserved%'",
      );
      if (Number(previous.rows[0]?.count) !== 0) {
        throw new Error("Earlier grid reservations exist without a database cursor; reconcile them before activation.");
      }
    }
    if (state.grid_hash !== null && state.monthly_budget_cents !== monthlyBudgetCents) {
      throw new Error("Configured monthly crawl budget differs from the saved limit; reconcile it before another paid request.");
    }
    const attempts = state.attempt_date === date ? state.attempted_today : 0;
    if (attempts >= DAILY_GRID_LIMIT) {
      await finish();
      return { status: "daily", attemptedToday: attempts };
    }
    const region = regionKey(point);
    const allocation = allocations[region];
    const cityBudget = allocation?.cities[point.city];
    if (!allocation || !Number.isSafeInteger(allocation.budget) || allocation.budget < 1 ||
        allocation.budget > MONTHLY_PAID_LIMIT || !Number.isSafeInteger(allocation.interval) ||
        allocation.interval < 1 || allocation.interval > 7 ||
        !Number.isSafeInteger(cityBudget) || cityBudget! < 1 || cityBudget! > allocation.budget) {
      throw new Error(`City/region budget for ${region}/${point.city} is unconfigured; no paid request was made.`);
    }
    const regionResult = await client.query<{
      region_budget: number; region_budget_used: number; next_region_run: string | null;
    }>(`
      INSERT INTO region_progress (region_name, budget_month, region_budget, region_interval)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (region_name) DO UPDATE SET
        budget_month = EXCLUDED.budget_month,
        region_budget = CASE WHEN region_progress.budget_month = EXCLUDED.budget_month
          THEN region_progress.region_budget ELSE EXCLUDED.region_budget END,
        region_budget_used = CASE WHEN region_progress.budget_month = EXCLUDED.budget_month
          THEN region_progress.region_budget_used ELSE 0 END,
        region_interval = CASE WHEN region_progress.budget_month = EXCLUDED.budget_month
          THEN region_progress.region_interval ELSE EXCLUDED.region_interval END
      RETURNING region_budget, region_budget_used, next_region_run::text
    `, [region, month, allocation.budget, allocation.interval]);
    const regionRow = regionResult.rows[0];
    if (regionRow.next_region_run && regionRow.next_region_run > date) {
      // Skip an entire region that is not yet due, without reserving a request.
      await client.query("UPDATE crawler_progress SET next_index = $1 WHERE id = 1",
        [nextRegionIndex]);
      await finish();
      return { status: "not_due", attemptedToday: attempts };
    }
    const cityResult = await client.query<{ city_budget: number; city_budget_used: number }>(`
      INSERT INTO city_progress (region_name, city_name, budget_month, city_budget)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (region_name, city_name) DO UPDATE SET
        budget_month = EXCLUDED.budget_month,
        city_budget = CASE WHEN city_progress.budget_month = EXCLUDED.budget_month
          THEN city_progress.city_budget ELSE EXCLUDED.city_budget END,
        city_budget_used = CASE WHEN city_progress.budget_month = EXCLUDED.budget_month
          THEN city_progress.city_budget_used ELSE 0 END
      RETURNING city_budget, city_budget_used
    `, [region, point.city, month, cityBudget]);
    const cityRow = cityResult.rows[0];
    if (regionRow.region_budget_used >= regionRow.region_budget) {
      const transition = exhaustedAllocationTransition("region", nextCityIndex, nextRegionIndex, gridLength);
      await client.query(`
        UPDATE region_progress SET next_region_run = ($2::date + INTERVAL '1 month')::date
        WHERE region_name = $1
      `, [region, month]);
      await client.query("UPDATE crawler_progress SET next_index = $1 WHERE id = 1",
        [transition.nextIndex]);
      await finish();
      return { status: "region", attemptedToday: attempts,
        budget: regionRow.region_budget, used: regionRow.region_budget_used, nextIndex: transition.resumeAt };
    }
    if (cityRow.city_budget_used >= cityRow.city_budget) {
      const transition = exhaustedAllocationTransition("city", nextCityIndex, nextRegionIndex, gridLength);
      if (transition.closeRegion) {
        await client.query(`
          UPDATE region_progress SET next_region_run = ($2::date + INTERVAL '1 month')::date
          WHERE region_name = $1
        `, [region, month]);
      }
      await client.query("UPDATE crawler_progress SET next_index = $1 WHERE id = 1",
        [transition.nextIndex]);
      await finish();
      return { status: "city", attemptedToday: attempts,
        budget: cityRow.city_budget, used: cityRow.city_budget_used, nextIndex: transition.resumeAt };
    }
    const usage = await client.query<{ spent: string; calls: string }>(`
      SELECT coalesce(sum(estimated_cost_cents), 0)::text AS spent,
             coalesce(sum(api_calls), 0)::text AS calls
      FROM restaurant_import_runs WHERE created_at >= $1::timestamptz
    `, [`${month}T00:00:00Z`]);
    const spent = Number(usage.rows[0].spent);
    const calls = Number(usage.rows[0].calls);
    if (paidGridBudgetReached(spent, calls, monthlyBudgetCents)) {
      await finish();
      return { status: "monthly", attemptedToday: attempts };
    }
    await client.query(`
      INSERT INTO restaurant_import_runs
        (cities, requested, imported, skipped_duplicates, api_calls, estimated_cost_cents,
         monthly_budget_cents, stopped_because)
      VALUES ($1, 10, 0, 0, 1, $2, $3, $4)
    `, [[point.city], ESTIMATED_GRID_REQUEST_COST_CENTS, monthlyBudgetCents,
      `Grid request reserved at point ${pointIndex}`]);
    const regionUpdate = await client.query(`
      UPDATE region_progress SET region_budget_used = region_budget_used + 1
      WHERE region_name = $1 AND budget_month = $2 AND region_budget_used < region_budget
    `, [region, month]);
    const cityUpdate = await client.query(`
      UPDATE city_progress SET city_budget_used = city_budget_used + 1
      WHERE region_name = $1 AND city_name = $2 AND budget_month = $3 AND city_budget_used < city_budget
    `, [region, point.city, month]);
    if (regionUpdate.rowCount !== 1 || cityUpdate.rowCount !== 1) {
      throw new Error("City or region budget changed during reservation; nothing was charged.");
    }
    await client.query(`
      UPDATE crawler_progress SET grid_hash = $1, pending_index = $2, attempt_date = $3,
        attempted_today = $4, monthly_budget_cents = $5, last_run = NOW()
      WHERE id = 1
    `, [hash, pointIndex, date, attempts + 1, monthlyBudgetCents]);
    await finish();
    return { status: "reserved", usedRequests: calls + 1,
      spentCents: spent + ESTIMATED_GRID_REQUEST_COST_CENTS, attemptedToday: attempts + 1,
      cityBudget: cityRow.city_budget, cityUsed: cityRow.city_budget_used + 1,
      regionBudget: regionRow.region_budget, regionUsed: regionRow.region_budget_used + 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Only completed provider results and restaurant writes advance the paid cursor. */
export async function completeGridPoint(
  hash: string, index: number, point: GridPoint, nextIndex: number,
  regionCompleted: boolean, gridCompleted: boolean,
  database: Pick<typeof pool, "connect"> = pool,
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ grid_hash: string; next_index: number; pending_index: number | null }>(
      "SELECT grid_hash, next_index, pending_index FROM crawler_progress WHERE id = 1 FOR UPDATE",
    );
    const state = result.rows[0];
    if (!state || state.grid_hash !== hash || state.next_index !== index || state.pending_index !== index) {
      throw new Error("Pending paid point changed; do not mark it complete.");
    }
    if (regionCompleted) {
      const update = await client.query(`
        UPDATE region_progress SET last_run = timezone('UTC', now())::date,
          next_region_run = timezone('UTC', now())::date + region_interval
        WHERE region_name = $1 RETURNING region_name
      `, [regionKey(point)]);
      if (update.rowCount !== 1) throw new Error("Region progress row disappeared.");
    }
    await client.query(`
      UPDATE crawler_progress SET pending_index = NULL, next_index = $1,
        automation_enabled = FALSE, cycle_completed = $2, last_run = NOW()
      WHERE id = 1
    `, [nextIndex, gridCompleted]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Operator-only recovery after checking the provider and ledger. The point is
 * skipped, never retried, and automation stays paused until another manual run.
 */
export async function skipUncertainGridPoint(
  hash: string, points: readonly GridPoint[], database: Pick<typeof pool, "connect"> = pool,
): Promise<number> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ grid_hash: string | null; pending_index: number | null }>(
      "SELECT grid_hash, pending_index FROM crawler_progress WHERE id = 1 FOR UPDATE",
    );
    const state = result.rows[0];
    if (!state || state.grid_hash !== hash || state.pending_index === null ||
        state.pending_index >= points.length) {
      throw new Error("No matching uncertain grid point can be skipped.");
    }
    const skipped = state.pending_index;
    const region = regionKey(points[skipped]);
    if (isTerminalRegionPoint(points, skipped)) {
      // An explicit skip closes this region's pass without claiming a completed
      // crawl. Do not immediately rebill its earlier points on the next run.
      const transition = await client.query(`
        UPDATE region_progress SET next_region_run = timezone('UTC', now())::date + region_interval
        WHERE region_name = $1 RETURNING region_name
      `, [region]);
      if (transition.rowCount !== 1) throw new Error("Region progress row disappeared.");
    }
    await client.query(`
      UPDATE crawler_progress SET pending_index = NULL, next_index = $1,
        automation_enabled = FALSE, cycle_completed = FALSE, last_run = NOW()
      WHERE id = 1
    `, [skipped + 1]);
    await client.query("COMMIT");
    return skipped;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}