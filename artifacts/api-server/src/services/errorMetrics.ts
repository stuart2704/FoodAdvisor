import { db, operationalLogEventsTable } from "@workspace/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { OperationalErrorCategory } from "../errors/errorService";

export interface ErrorMetric {
  error_type: OperationalErrorCategory;
  engine: string;
  count: number;
}

export async function getErrorMetrics(): Promise<ErrorMetric[]> {
  const since = new Date(Date.now() - 10 * 60_000);
  const errorType = sql<OperationalErrorCategory>`
    case
      when ${operationalLogEventsTable.tags} @> array['timeout']::text[]
        then 'timeout'
      when ${operationalLogEventsTable.tags} @> array['network_error']::text[]
        then 'network_error'
      when ${operationalLogEventsTable.tags} @> array['auth_error']::text[]
        then 'auth_error'
      when ${operationalLogEventsTable.tags} @> array['db_error']::text[]
        then 'db_error'
      when ${operationalLogEventsTable.tags} @> array['validation_error']::text[]
        then 'validation_error'
      when ${operationalLogEventsTable.tags} @> array['rate_limit']::text[]
        then 'rate_limit'
      else 'unknown_error'
    end
  `;

  const rows = await db
    .select({
      error_type: errorType,
      engine: operationalLogEventsTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(operationalLogEventsTable)
    .where(
      and(
        eq(operationalLogEventsTable.category, "error"),
        gte(operationalLogEventsTable.createdAt, since),
      ),
    )
    .groupBy(errorType, operationalLogEventsTable.type)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({
    error_type: row.error_type,
    engine: row.engine,
    count: Number(row.count),
  }));
}