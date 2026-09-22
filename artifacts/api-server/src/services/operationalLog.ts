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
}

const MAX_MESSAGE_LENGTH = 1_000;
const MAX_CATEGORY_LENGTH = 64;
const MAX_TYPE_LENGTH = 32;

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
  avg_latency_ms: null;
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
          avg_latency_ms: null,
        },
      ];
    }),
  );
}