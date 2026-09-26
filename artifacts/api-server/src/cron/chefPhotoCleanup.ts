import { db, chefPhotoDeletionQueueTable, chefPhotoUploadIntentsTable, restaurantChefProfilesTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";
import cron from "node-cron";
import { deleteChefObject } from "../lib/chefObjectStorage";
import { logger } from "../lib/logger";

let task: ReturnType<typeof cron.schedule> | undefined;
let running = false;
const RETRY_MS = 60 * 60_000;

type Candidate = { objectPath: string; id?: string };

async function cleanOne(kind: "queue" | "intent", now: Date): Promise<boolean> {
  const retryAt = new Date(now.getTime() + RETRY_MS);
  // Keep the row locked through the remote delete: another worker cannot claim it.
  return db.transaction(async (tx) => {
    const result = kind === "queue"
      ? await tx.execute(sql`SELECT object_path AS "objectPath" FROM chef_photo_deletion_queue
          WHERE due_at <= ${now} ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED`)
      : await tx.execute(sql`SELECT id, object_path AS "objectPath" FROM chef_photo_upload_intents
          WHERE cleanup_after <= ${now}
            AND expires_at <= ${new Date(now.getTime() - 15 * 60_000)}
            AND (consumed_at IS NULL OR consumed_at <= ${new Date(now.getTime() - 24 * 60 * 60_000)})
          ORDER BY cleanup_after LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const candidate = result.rows[0] as Candidate | undefined;
    if (!candidate) return false;
    // Profile writers acquire this lock before linking a path. Check every status,
    // including pending and approved (and rejected), before deleting an object.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chef-photo:${candidate.objectPath}`}, 72))`);
    const [reference] = await tx.select({ restaurantId: restaurantChefProfilesTable.restaurantId })
      .from(restaurantChefProfilesTable)
      .where(eq(restaurantChefProfilesTable.photoObjectPath, candidate.objectPath)).limit(1);
    let failed = false;
    if (!reference) {
      try {
        await deleteChefObject(candidate.objectPath);
      } catch (error) {
        failed = true;
        logger.warn({ err: error, objectPath: candidate.objectPath, kind }, "Chef photo deletion failed; retry scheduled");
      }
    }
    if (kind === "queue") {
      if (failed) {
        await tx.update(chefPhotoDeletionQueueTable).set({ dueAt: retryAt })
          .where(eq(chefPhotoDeletionQueueTable.objectPath, candidate.objectPath));
      } else {
        await tx.delete(chefPhotoDeletionQueueTable).where(eq(chefPhotoDeletionQueueTable.objectPath, candidate.objectPath));
      }
    } else if (candidate.id) {
      if (failed) {
        await tx.update(chefPhotoUploadIntentsTable).set({ cleanupAfter: retryAt })
          .where(eq(chefPhotoUploadIntentsTable.id, candidate.id));
      } else {
        await tx.delete(chefPhotoUploadIntentsTable).where(eq(chefPhotoUploadIntentsTable.id, candidate.id));
      }
    }
    return true;
  });
}

export async function cleanupChefPhotos(now = new Date()): Promise<void> {
  for (const kind of ["queue", "intent"] as const) {
    for (let i = 0; i < 50; i++) {
      if (!await cleanOne(kind, now)) break;
    }
  }
}

export function startChefPhotoCleanup() {
  if (task) return task;
  task = cron.schedule("35 * * * *", () => void runCleanup(), {
    timezone: "Etc/UTC", noOverlap: true, name: "chef-photo-cleanup",
  });
  void runCleanup();
  return task;
}

async function runCleanup() {
  if (running) return;
  running = true;
  try {
    await cleanupChefPhotos();
  } catch (error) {
    logger.error({ err: error }, "Chef photo cleanup failed; will retry next run");
  } finally {
    running = false;
  }
}