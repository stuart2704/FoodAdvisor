import cron from "node-cron";
import { db, restaurantPhotoDeletionQueueTable, restaurantPhotoIntentsTable, restaurantPhotosTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { deletePhoto } from "../lib/restaurantPhotoStorage";
import { logger } from "../lib/logger";

let running = false;

async function clean(kind: "queue" | "intent", now: Date): Promise<boolean> {
  return db.transaction(async tx => {
    const result = kind === "queue"
      ? await tx.execute(sql`SELECT object_path AS "objectPath" FROM restaurant_photo_deletion_queue
          WHERE due_at <= ${now} ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED`)
      : await tx.execute(sql`SELECT id, object_path AS "objectPath" FROM restaurant_photo_intents
          WHERE cleanup_after <= ${now} AND expires_at <= ${new Date(now.getTime() - 15 * 60_000)}
          AND (consumed_at IS NULL OR consumed_at <= ${new Date(now.getTime() - 24 * 60 * 60_000)})
          ORDER BY cleanup_after LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const candidate = result.rows[0] as { id?: string; objectPath: string } | undefined;
    if (!candidate) return false;
    // A linked upload must never be deleted even if its intent has expired.
    const [linked] = await tx.select({ id: restaurantPhotosTable.id }).from(restaurantPhotosTable)
      .where(eq(restaurantPhotosTable.objectPath, candidate.objectPath)).limit(1);
    let failed = false;
    if (!linked) {
      try { await deletePhoto(candidate.objectPath); }
      catch (error) {
        failed = true;
        logger.warn({ err: error, kind }, "Restaurant photo cleanup will retry");
      }
    }
    if (kind === "queue") {
      if (failed) await tx.update(restaurantPhotoDeletionQueueTable).set({ dueAt: new Date(now.getTime() + 60 * 60_000) })
        .where(eq(restaurantPhotoDeletionQueueTable.objectPath, candidate.objectPath));
      else await tx.delete(restaurantPhotoDeletionQueueTable).where(eq(restaurantPhotoDeletionQueueTable.objectPath, candidate.objectPath));
    } else if (candidate.id) {
      if (failed) await tx.update(restaurantPhotoIntentsTable).set({ cleanupAfter: new Date(now.getTime() + 60 * 60_000) })
        .where(eq(restaurantPhotoIntentsTable.id, candidate.id));
      else await tx.delete(restaurantPhotoIntentsTable).where(eq(restaurantPhotoIntentsTable.id, candidate.id));
    }
    return true;
  });
}

export async function cleanupRestaurantPhotos(now = new Date()) {
  for (const kind of ["queue", "intent"] as const)
    for (let i = 0; i < 50 && await clean(kind, now); i++) { /* bounded batch */ }
}

export function startRestaurantPhotoCleanup() {
  const run = async () => {
    if (running) return;
    running = true;
    try { await cleanupRestaurantPhotos(); }
    catch (error) { logger.warn({ err: error }, "Restaurant photo cleanup failed"); }
    finally { running = false; }
  };
  const task = cron.schedule("40 * * * *", () => void run(), { timezone: "Etc/UTC", noOverlap: true });
  void run();
  return task;
}