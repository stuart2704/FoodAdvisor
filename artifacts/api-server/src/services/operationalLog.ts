import {
  db,
  operationalLogEventsTable,
  type OperationalLogEvent,
} from "@workspace/db";
import {
  and,
  arrayContains,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
} from "drizzle-orm";

export interface SanitizedOperationalEvent {
  id: string;
  time: string;
  type: string;
  message: string;
  category?: string;
  bookmarked: boolean;
  tags: string[];
  durationMs?: number;
}

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_CATEGORY_LENGTH = 64;
const MAX_TYPE_LENGTH = 32;
export const MAX_OPERATION_DURATION_MS = 600_000;

export function boundedDurationMs(durationMs: number): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return Math.min(MAX_OPERATION_DURATION_MS, Math.round(durationMs));
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|password|secret|token)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeOperationalEvent(
  type: string,
  message: string,
  category?: string,
): Omit<SanitizedOperationalEvent, "id" | "time" | "bookmarked" | "tags"> {
  const normalizedType =
    type
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, MAX_TYPE_LENGTH) || "info";
  const normalizedMessage =
    redactSensitiveText(message).slice(0, MAX_MESSAGE_LENGTH) ||
    "Operational event";
  const normalizedCategory = category
    ? category
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .slice(0, MAX_CATEGORY_LENGTH)
    : "";
  return {
    type: normalizedType,
    message: normalizedMessage,
    ...(normalizedCategory ? { category: normalizedCategory } : {}),
  };
}

export async function persistOperationalEvent(
  event: SanitizedOperationalEvent,
): Promise<void> {
  await db
    .insert(operationalLogEventsTable)
    .values({
      id: event.id,
      createdAt: new Date(event.time),
      type: event.type,
      message: event.message,
      category: event.category,
      bookmarked: event.bookmarked,
      tags: event.tags,
      durationMs: event.durationMs,
    })
    .onConflictDoNothing();
}

function serializeEvent(event: OperationalLogEvent): SanitizedOperationalEvent {
  return {
    id: event.id,
    time: event.createdAt.toISOString(),
    type: event.type,
    message: event.message,
    ...(event.category ? { category: event.category } : {}),
    bookmarked: event.bookmarked,
    tags: [...event.tags],
  };
}

export async function listOperationalEvents(options: {
  page: number;
  limit: number;
  type?: string;
  tag?: string;
  bookmarked?: boolean;
}) {
  const filters = [
    ...(options.type
      ? [eq(operationalLogEventsTable.type, options.type)]
      : []),
    ...(options.tag
      ? [arrayContains(operationalLogEventsTable.tags, [options.tag])]
      : []),
    ...(options.bookmarked === undefined
      ? []
      : [eq(operationalLogEventsTable.bookmarked, options.bookmarked)]),
  ];
  const rows = await db
    .select()
    .from(operationalLogEventsTable)
    .where(and(...filters))
    .orderBy(
      desc(operationalLogEventsTable.createdAt),
      desc(operationalLogEventsTable.id),
    )
    .limit(options.limit + 1)
    .offset((options.page - 1) * options.limit);
  return {
    items: rows.slice(0, options.limit).map(serializeEvent),
    hasMore: rows.length > options.limit,
  };
}

export async function setOperationalEventBookmark(
  id: string,
  bookmarked: boolean,
): Promise<boolean> {
  const rows = await db
    .update(operationalLogEventsTable)
    .set({ bookmarked })
    .where(eq(operationalLogEventsTable.id, id))
    .returning({ id: operationalLogEventsTable.id });
  return rows.length === 1;
}

export async function setOperationalEventTags(
  id: string,
  tags: string[],
): Promise<boolean> {
  const rows = await db
    .update(operationalLogEventsTable)
    .set({ tags })
    .where(eq(operationalLogEventsTable.id, id))
    .returning({ id: operationalLogEventsTable.id });
  return rows.length === 1;
}

export async function getOperationalEventsByIds(
  ids: string[],
): Promise<SanitizedOperationalEvent[]> {
  const rows = await db
    .select()
    .from(operationalLogEventsTable)
    .where(inArray(operationalLogEventsTable.id, ids))
    .orderBy(
      desc(operationalLogEventsTable.createdAt),
      desc(operationalLogEventsTable.id),
    );
  return rows.map(serializeEvent);
}

export async function cleanupOperationalEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  const rows = await db
    .delete(operationalLogEventsTable)
    .where(lt(operationalLogEventsTable.createdAt, cutoff))
    .returning({ id: operationalLogEventsTable.id });
  return rows.length;
}

export interface OperationalMetrics {
  ai_requests_last_minute: number;
  automation_tasks_last_minute: number;
  queue_jobs_last_minute: number;
  api_calls_last_minute: number;
  db_queries_last_minute: number;
}

export async function getOperationalMetrics(): Promise<OperationalMetrics> {
  const since = new Date(Date.now() - 60_000);
  const rows = await db
    .select({
      type: operationalLogEventsTable.type,
      count: sql<number>`count(*)::int`,
    })
    .from(operationalLogEventsTable)
    .where(gte(operationalLogEventsTable.createdAt, since))
    .groupBy(operationalLogEventsTable.type);

  const metrics: OperationalMetrics = {
    ai_requests_last_minute: 0,
    automation_tasks_last_minute: 0,
    queue_jobs_last_minute: 0,
    api_calls_last_minute: 0,
    db_queries_last_minute: 0,
  };

  for (const row of rows) {
    const count = Number(row.count);
    if (!Number.isFinite(count)) continue;
    switch (row.type) {
      case "ai":
        metrics.ai_requests_last_minute = count;
        break;
      case "automation":
        metrics.automation_tasks_last_minute = count;
        break;
      case "queue":
        metrics.queue_jobs_last_minute = count;
        break;
      case "api":
        metrics.api_calls_last_minute = count;
        break;
      case "database":
        metrics.db_queries_last_minute = count;
        break;
    }
  }
  return metrics;
}

export interface EnginePerformanceMetric {
  total: number;
  errors: number;
  successes: number;
  error_rate: number;
  success_rate: number;
  latency_samples: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
}

export type EnginePerformanceMetrics = Record<
  string,
  EnginePerformanceMetric
>;

export async function getEnginePerformanceMetrics(): Promise<
  EnginePerformanceMetrics
> {
  const since = new Date(Date.now() - 5 * 60_000);
  const rows = await db
    .select({
      engine: operationalLogEventsTable.type,
      total: sql<number>`count(*)::int`,
      errors: sql<number>`
        count(*) filter (
          where ${operationalLogEventsTable.category} = 'error'
        )::int
      `,
      successes: sql<number>`
        count(*) filter (
          where ${operationalLogEventsTable.category} in ('info', 'success')
        )::int
      `,
      latencySamples: sql<number>`count(${operationalLogEventsTable.durationMs})::int`,
      avgLatency: sql<number | null>`round(avg(${operationalLogEventsTable.durationMs}))::int`,
      p95Latency: sql<number | null>`round((percentile_cont(0.95) within group (order by ${operationalLogEventsTable.durationMs}))::numeric)::int`,
    })
    .from(operationalLogEventsTable)
    .where(gte(operationalLogEventsTable.createdAt, since))
    .groupBy(operationalLogEventsTable.type);

  return Object.fromEntries(
    rows.map((row) => {
      const total = Number(row.total);
      const errors = Number(row.errors);
      const successes = Number(row.successes);
      return [
        row.engine,
        {
          total,
          errors,
          successes,
          error_rate: total > 0 ? errors / total : 0,
          success_rate: total > 0 ? successes / total : 0,
          latency_samples: Number(row.latencySamples),
          avg_latency_ms: row.avgLatency == null ? null : Number(row.avgLatency),
          p95_latency_ms: row.p95Latency == null ? null : Number(row.p95Latency),
        },
      ];
    }),
  );
}

const LATENCY_ALERT_WINDOW_MINUTES = 5;
const LATENCY_ALERT_MIN_SAMPLES_PER_MINUTE = 3;
const DEFAULT_LATENCY_ALERT_THRESHOLD_MS = 2_000;

export interface EngineLatencyAlert {
  status: "high" | "normal" | "insufficient_data";
  measuredMinutes: number;
  requiredMinutes: number;
  minimumSamplesPerMinute: number;
  thresholdMs: number;
}

export function engineLatencyAlertThresholdMs(): number {
  const raw = process.env.ENGINE_LATENCY_ALERT_THRESHOLD_MS;
  if (raw === undefined) return DEFAULT_LATENCY_ALERT_THRESHOLD_MS;
  const value = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value) || value > MAX_OPERATION_DURATION_MS) {
    throw new Error("ENGINE_LATENCY_ALERT_THRESHOLD_MS must be an integer between 1 and 600000.");
  }
  return value;
}

export function evaluateEngineLatencyAlert(
  buckets: Array<{ minute: number; samples: number; p95Ms: number | null }>,
  windowEndMs: number,
  thresholdMs: number,
): EngineLatencyAlert {
  const byMinute = new Map(buckets.map((bucket) => [bucket.minute, bucket]));
  let measuredMinutes = 0;
  let allHigh = true;
  for (let offset = 1; offset <= LATENCY_ALERT_WINDOW_MINUTES; offset++) {
    const bucket = byMinute.get(windowEndMs - offset * 60_000);
    if (!bucket || bucket.samples < LATENCY_ALERT_MIN_SAMPLES_PER_MINUTE ||
        bucket.p95Ms === null || !Number.isFinite(bucket.p95Ms)) continue;
    measuredMinutes++;
    if (bucket.p95Ms <= thresholdMs) allHigh = false;
  }
  return {
    status: measuredMinutes < LATENCY_ALERT_WINDOW_MINUTES ? "insufficient_data" : allHigh ? "high" : "normal",
    measuredMinutes,
    requiredMinutes: LATENCY_ALERT_WINDOW_MINUTES,
    minimumSamplesPerMinute: LATENCY_ALERT_MIN_SAMPLES_PER_MINUTE,
    thresholdMs,
  };
}

export async function getEngineLatencyAlerts(): Promise<Record<string, EngineLatencyAlert>> {
  const thresholdMs = engineLatencyAlertThresholdMs();
  // Exclude the current, incomplete minute. A missing minute is never treated as fast or slow.
  const windowEndMs = Math.floor(Date.now() / 60_000) * 60_000;
  const rows = await db
    .select({
      engine: operationalLogEventsTable.type,
      minute: sql<string>`extract(epoch from date_trunc('minute', ${operationalLogEventsTable.createdAt}))::bigint`,
      samples: sql<number>`count(${operationalLogEventsTable.durationMs})::int`,
      p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${operationalLogEventsTable.durationMs})`,
    })
    .from(operationalLogEventsTable)
    .where(and(
      gte(operationalLogEventsTable.createdAt, new Date(windowEndMs - LATENCY_ALERT_WINDOW_MINUTES * 60_000)),
      lt(operationalLogEventsTable.createdAt, new Date(windowEndMs)),
    ))
    .groupBy(operationalLogEventsTable.type, sql`date_trunc('minute', ${operationalLogEventsTable.createdAt})`);

  const byEngine = new Map<string, Array<{ minute: number; samples: number; p95Ms: number | null }>>();
  for (const row of rows) {
    const buckets = byEngine.get(row.engine) ?? [];
    buckets.push({
      minute: Number(row.minute) * 1_000,
      samples: Number(row.samples),
      p95Ms: row.p95Ms == null ? null : Number(row.p95Ms),
    });
    byEngine.set(row.engine, buckets);
  }
  return Object.fromEntries(
    ["ai", "automation", "queue", "api", "database"].map((engine) => [
      engine,
      evaluateEngineLatencyAlert(byEngine.get(engine) ?? [], windowEndMs, thresholdMs),
    ]),
  );
}