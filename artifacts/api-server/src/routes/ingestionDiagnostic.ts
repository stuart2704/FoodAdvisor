import { pool } from "@workspace/db";
import { Router, type IRouter } from "express";
import { getDailyOutreachSchedulerStatus } from "../cron/dailyOutreach";
import { ESTIMATED_GRID_REQUEST_COST_CENTS, MONTHLY_PAID_LIMIT } from "../lib/gridCrawlPlan";
import { adminOnly } from "../middleware/adminOnly";

const router: IRouter = Router();
router.use(adminOnly);

type CountRow = { total: string; today: string };
type ActivityRow = {
  event: string;
  total: string;
  today: string;
  latest: Date | null;
};

router.get("/operations/ingestion-diagnostic", async (req, res) => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  try {
    const [grid, budget, external, cities, googleCities, restaurants, sources, candidates, candidateSources, activity] =
      await Promise.all([
        pool.query<{
          automation_enabled: boolean;
          last_run: Date | null;
          grid_initialized: boolean;
          attempted_today: number;
        }>(
          `SELECT automation_enabled, last_run, grid_hash IS NOT NULL AS grid_initialized,
                  CASE WHEN attempt_date = $1::date THEN attempted_today ELSE 0 END AS attempted_today
           FROM crawler_progress WHERE id = 1`,
          [today.toISOString().slice(0, 10)],
        ),
        pool.query<{ calls: string; estimated_cents: string; cap_cents: number | null }>(
          `SELECT coalesce(sum(r.api_calls), 0)::text AS calls,
                  coalesce(sum(r.estimated_cost_cents), 0)::text AS estimated_cents,
                  (SELECT monthly_budget_cents FROM crawler_progress WHERE id = 1) AS cap_cents
           FROM restaurant_import_runs r WHERE r.created_at >= $1`,
          [month],
        ),
        pool.query<{ id: string; last_run_at: Date | null }>(
          `SELECT id, last_run_at FROM external_ingestion_schedule
           WHERE id = 'external_ingestion_last_run' OR id LIKE 'manual_city_ingestion:%'
           ORDER BY last_run_at DESC NULLS LAST LIMIT 30`,
        ),
        pool.query<{ city: string; last_run_at: Date }>(
          `SELECT substring(id FROM length('manual_city_ingestion:') + 1) AS city,
                  last_run_at
           FROM external_ingestion_schedule
           WHERE id LIKE 'manual_city_ingestion:%' AND last_run_at IS NOT NULL
           ORDER BY last_run_at DESC LIMIT 20`,
        ),
        pool.query<{ city: string; last_run_at: Date }>(
          `SELECT city, max(r.created_at) AS last_run_at
           FROM restaurant_import_runs r CROSS JOIN LATERAL unnest(r.cities) AS city
           WHERE r.stopped_because NOT LIKE 'Places request reserved:%'
             AND r.api_calls > 0
           GROUP BY city ORDER BY last_run_at DESC LIMIT 20`,
        ),
        pool.query<CountRow>(
          `SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE imported_at >= $1)::text AS today
           FROM restaurants`,
          [today],
        ),
        pool.query<{ source_name: string; total: string }>(
          `SELECT source_name, count(*)::text AS total FROM restaurants
           GROUP BY source_name ORDER BY total DESC`,
        ),
        pool.query<CountRow>(
          `SELECT count(*)::text AS total,
                  count(*) FILTER (WHERE imported_at >= $1)::text AS today
           FROM external_candidates`,
          [today],
        ),
        pool.query<{ source_name: string; total: string; today: string }>(
          `SELECT source_name, count(*)::text AS total,
                  count(*) FILTER (WHERE imported_at >= $1)::text AS today
           FROM external_candidates GROUP BY source_name ORDER BY total DESC`,
          [today],
        ),
        pool.query<ActivityRow>(
          `SELECT event, count(*)::text AS total,
                  count(*) FILTER (WHERE created_at >= $1)::text AS today,
                  max(created_at) AS latest
           FROM outreach_audit
           WHERE event IN ('send_attempt', 'sent', 'send_failed', 'reply_classified')
           GROUP BY event`,
          [today],
        ),
      ]);

    if (!grid.rows[0] || budget.rows[0]?.cap_cents == null) {
      throw new Error("Crawler budget state is missing.");
    }
    const counts = (event: string) => {
      const row = activity.rows.find((item) => item.event === event);
      return { today: Number(row?.today ?? 0), total: Number(row?.total ?? 0), latest: row?.latest ?? null };
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      success: true,
      checkedAt: now.toISOString(),
      dayStartUtc: today.toISOString(),
      grid: {
        automationEnabled: grid.rows[0]?.automation_enabled ?? false,
        initialized: grid.rows[0]?.grid_initialized ?? false,
        lastRunAt: grid.rows[0]?.last_run ?? null,
        pointsAttemptedToday: grid.rows[0]?.attempted_today ?? 0,
        month: {
          calls: Number(budget.rows[0]?.calls ?? 0),
          estimatedCostCents: Number(budget.rows[0]?.estimated_cents ?? 0),
          budgetCents: budget.rows[0].cap_cents,
          maxCalls: Math.min(MONTHLY_PAID_LIMIT, Math.floor(budget.rows[0].cap_cents / ESTIMATED_GRID_REQUEST_COST_CENTS)),
        },
      },
      external: {
        lastSuccessfulScheduledRunAt:
          external.rows.find((row) => row.id === "external_ingestion_last_run")?.last_run_at ?? null,
        candidates: {
          today: Number(candidates.rows[0]?.today ?? 0),
          total: Number(candidates.rows[0]?.total ?? 0),
          bySource: candidateSources.rows.map((row) => ({
            source: row.source_name,
            today: Number(row.today),
            total: Number(row.total),
          })),
        },
      },
      cities: [
        ...cities.rows.map((row) => ({ city: row.city, source: "Manual open-data import", lastRunAt: row.last_run_at })),
        ...googleCities.rows.map((row) => ({ city: row.city, source: "Google import", lastRunAt: row.last_run_at })),
      ].sort((a, b) => new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime()).slice(0, 20),
      restaurants: {
        today: Number(restaurants.rows[0]?.today ?? 0),
        total: Number(restaurants.rows[0]?.total ?? 0),
        bySource: sources.rows.map((row) => ({ source: row.source_name, total: Number(row.total) })),
      },
      outreach: {
        schedulerEnabled: getDailyOutreachSchedulerStatus().enabled,
        attempts: counts("send_attempt"),
        confirmedSends: counts("sent"),
        failures: counts("send_failed"),
        classifiedReplies: counts("reply_classified"),
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Ingestion and outreach diagnostic failed");
    res.status(503).json({ success: false, error: "The diagnostic is temporarily unavailable." });
  }
});

export default router;