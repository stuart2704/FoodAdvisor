import { db, engineHeartbeatsTable } from "@workspace/db";
import { logEvent } from "../utils/eventLog";

export type EngineStatus = "online" | "offline";

const DEFAULT_ONLINE_WINDOW_MS = 5 * 60_000;
const ONLINE_WINDOWS_MS: Readonly<Record<string, number>> = {
  api: 45_000,
  database: 45_000,
  queue: 45 * 60_000,
  ai: 4 * 60 * 60_000,
  automation: 4 * 60 * 60_000,
};

function normalizeEngine(engine: string): string {
  return engine
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 32);
}

export async function recordHeartbeat(engine: string): Promise<void> {
  const normalized = normalizeEngine(engine);
  if (!normalized) throw new Error("Engine is required.");
  const now = new Date();
  const started = normalized === "database" ? performance.now() : null;
  await db
    .insert(engineHeartbeatsTable)
    .values({ engine: normalized, lastHeartbeat: now })
    .onConflictDoUpdate({
      target: engineHeartbeatsTable.engine,
      set: { lastHeartbeat: now },
    });
  if (started !== null) {
    logEvent("database", "Database heartbeat write completed", "success", [], performance.now() - started);
  }
}

export async function getEngineStatuses(): Promise<
  Record<string, EngineStatus>
> {
  const rows = await db.select().from(engineHeartbeatsTable);
  const now = Date.now();
  return Object.fromEntries(
    rows.map((row) => [
      row.engine,
      getHeartbeatStatus(row.engine, row.lastHeartbeat, now),
    ]),
  );
}

export function getHeartbeatStatus(
  engine: string,
  lastHeartbeat: Date,
  now = Date.now(),
): EngineStatus {
  const normalized = normalizeEngine(engine);
  const onlineWindow =
    ONLINE_WINDOWS_MS[normalized] ?? DEFAULT_ONLINE_WINDOW_MS;
  const age = now - lastHeartbeat.getTime();
  return age >= 0 && age < onlineWindow ? "online" : "offline";
}