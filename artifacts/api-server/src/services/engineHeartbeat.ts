import { db, engineHeartbeatsTable } from "@workspace/db";

export type EngineStatus = "online" | "offline";

const ONLINE_WINDOW_MS = 30_000;

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
  await db
    .insert(engineHeartbeatsTable)
    .values({ engine: normalized, lastHeartbeat: now })
    .onConflictDoUpdate({
      target: engineHeartbeatsTable.engine,
      set: { lastHeartbeat: now },
    });
}

export async function getEngineStatuses(): Promise<
  Record<string, EngineStatus>
> {
  const rows = await db.select().from(engineHeartbeatsTable);
  const now = Date.now();
  return Object.fromEntries(
    rows.map((row) => [
      row.engine,
      now - row.lastHeartbeat.getTime() < ONLINE_WINDOW_MS
        ? "online"
        : "offline",
    ]),
  );
}