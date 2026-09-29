import { pool } from "@workspace/db";

export async function getPlacesAllowanceUsage() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // All categories are constants: no city, place ID, or caller-provided label is returned.
  // Search Text keeps its reservation category in cities[1] even after completion
  // replaces stopped_because with the outcome.
  const [usage, cap] = await Promise.all([
    pool.query<{ label: string; requests: string; denied: string; estimated_cents: string }>(`
      WITH categorized AS (
        SELECT CASE
          WHEN stopped_because LIKE 'Grid request reserved at point %'
            OR stopped_because = 'Grid request denied: monthly budget' THEN 'Grid crawl'
          WHEN stopped_because IN ('Places request reserved: Place photo details', 'Places request denied: Place photo details') THEN 'Place photo details'
          WHEN stopped_because IN ('Places request reserved: Place photo media', 'Places request denied: Place photo media') THEN 'Place photo media'
          WHEN stopped_because IN ('Places request reserved: Place reviews', 'Places request denied: Place reviews') THEN 'Place reviews'
          WHEN stopped_because IN ('Places request reserved: Place price', 'Places request denied: Place price') THEN 'Place price'
          WHEN stopped_because IN ('Places request reserved: Place opening status', 'Places request denied: Place opening status') THEN 'Place opening status'
          WHEN stopped_because IN ('Places request reserved: Place opening hours', 'Places request denied: Place opening hours') THEN 'Place opening hours'
          WHEN stopped_because IN ('Place Details amenities reserved', 'Place Details amenities denied: monthly budget')
            THEN 'Place Details amenities'
          WHEN cities[1] LIKE 'Search Text for %'
            OR stopped_because = 'Places request denied: Search Text' THEN 'Search Text'
          ELSE 'Other Places / imports'
        END AS label, api_calls, estimated_cost_cents, stopped_because
        FROM restaurant_import_runs WHERE created_at >= $1
      )
      SELECT label, sum(api_calls)::text AS requests,
             count(*) FILTER (WHERE stopped_because LIKE 'Places request denied: %'
               OR stopped_because IN ('Grid request denied: monthly budget',
                 'Place Details amenities denied: monthly budget'))::text AS denied,
             sum(estimated_cost_cents)::text AS estimated_cents
      FROM categorized GROUP BY label ORDER BY label
    `, [monthStart]),
    pool.query<{ monthly_budget_cents: number }>(
      "SELECT monthly_budget_cents FROM crawler_progress WHERE id = 1",
    ),
  ]);
  if (cap.rowCount !== 1) throw new Error("Shared Places budget row is missing.");
  const labels = usage.rows.map((row) => ({
    label: row.label,
    requests: Number(row.requests),
    denied: Number(row.denied),
    estimatedCents: Number(row.estimated_cents),
  }));
  return {
    checkedAt: new Date().toISOString(),
    monthStart: monthStart.toISOString(),
    budgetCents: cap.rows[0].monthly_budget_cents,
    requests: labels.reduce((sum, row) => sum + row.requests, 0),
    denied: labels.reduce((sum, row) => sum + row.denied, 0),
    estimatedCents: labels.reduce((sum, row) => sum + row.estimatedCents, 0),
    labels,
  };
}