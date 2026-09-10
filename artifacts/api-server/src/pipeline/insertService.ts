import { logEvent } from "../utils/eventLog";
import { parseRestaurant, type QueuedRestaurant } from "./validator";
import { dbInsertRestaurant, type InsertedRestaurant } from "./neonClient";
export type { QueuedRestaurant } from "./validator";
export type { InsertedRestaurant } from "./neonClient";

// Temporary, process-local queue. A restart loses pending entries.
const insertionQueue = new Map<string, QueuedRestaurant>();
const MAX_PENDING = 1000;
let draining = false;

export function queueForInsertion(input: unknown): void {
  const restaurant = parseRestaurant(input);
  if (insertionQueue.has(restaurant.placeId)) {
    logEvent("info", "Restaurant already queued; duplicate ignored");
    return;
  }
  if (insertionQueue.size >= MAX_PENDING) {
    throw new Error("Insertion queue is full. Drain pending records before adding more.");
  }
  insertionQueue.set(restaurant.placeId, restaurant);
  logEvent("info", "Restaurant queued for insertion");
}

export function getPendingInsertions(): QueuedRestaurant[] {
  return Array.from(insertionQueue.values(), (restaurant) => ({
    ...restaurant,
    types: [...restaurant.types],
  }));
}

export async function insertRestaurant(input: unknown): Promise<InsertedRestaurant | null> {
  return dbInsertRestaurant(input);
}

export class InsertionBatchError extends Error {
  constructor(
    readonly inserted: InsertedRestaurant[],
    readonly failedCount: number,
  ) {
    super(`Insertion batch incomplete: ${failedCount} records remain queued for retry.`);
    this.name = "InsertionBatchError";
  }
}

export async function insertQueuedRestaurants(): Promise<InsertedRestaurant[]> {
  if (draining) throw new Error("An insertion batch is already running.");
  draining = true;
  logEvent("info", "Insertion batch started");
  const results: InsertedRestaurant[] = [];
  let failedCount = 0;
  try {
    // Records added during this batch belong to the next batch.
    const batch = Array.from(insertionQueue.entries());
    for (const [placeId, restaurant] of batch) {
      try {
        const inserted = await insertRestaurant(restaurant);
        if (inserted) results.push(inserted);
        // A successful insert or confirmed duplicate can be removed.
        if (insertionQueue.get(placeId) === restaurant) insertionQueue.delete(placeId);
      } catch {
        failedCount += 1;
        // Preserve failures rather than clearing the queue.
      }
    }
    if (failedCount > 0) {
      logEvent("error", `Insertion batch incomplete: ${failedCount} records retained for retry`);
      throw new InsertionBatchError(results, failedCount);
    }
    logEvent("success", `Insertion batch finished (${results.length} inserted)`);
    return results;
  } finally {
    draining = false;
  }
}