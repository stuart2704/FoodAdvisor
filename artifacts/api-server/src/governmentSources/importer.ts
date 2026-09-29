import { db, governmentImportRunsTable, governmentImportSourcesTable, restaurantsTable } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { fetchFsaBatch } from "./fsa";
import { fetchFranceBatch } from "./france";
import type { GovernmentListing, GovernmentSource } from "./types";

export const PUBLIC_SOURCES = ["FSA_UK", "ALIM_FR"] as const;
export const DAILY_NEW_LIMIT = 100;

export function sourceIsPublishable(source: GovernmentSource): boolean {
  // NYC is inspection history, including permit applicants and closed venues;
  // neither its reuse terms nor current-business status is established.
  return source === "FSA_UK" || source === "ALIM_FR";
}

/**
 * There is no account-specific, read-only Replit cost feed connected here.
 * Never infer pounds from row counts or from a manually typed estimate.
 * A future meter must check incremental hosting + database usage against
 * a verified monthly baseline immediately before each batch.
 */
export async function billingGate(): Promise<{ ready: false; reason: string }> {
  return { ready: false, reason: "A verified billing baseline and automatic cost meter are not connected." };
}

export function sourceKey(listing: GovernmentListing): string {
  return `gov:${listing.source.toLowerCase()}:${listing.sourceId}`;
}

export async function saveGovernmentListing(listing: GovernmentListing): Promise<"inserted" | "updated" | "skipped"> {
  if (!sourceIsPublishable(listing.source) || !listing.name || !listing.address || !listing.city || !listing.sourceId) {
    return "skipped";
  }
  const key = sourceKey(listing);
  return db.transaction(async (tx) => {
    // Serialise this source record even when two workers race a daily run.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${listing.source}), hashtext(${listing.sourceId}))`);
    const [existing] = await tx.select({
      placeId: restaurantsTable.placeId,
      sourceName: restaurantsTable.sourceName,
      sourceId: restaurantsTable.sourceId,
      claimedAt: restaurantsTable.claimedAt,
      claimStatus: restaurantsTable.claimStatus,
    }).from(restaurantsTable).where(eq(restaurantsTable.placeId, key)).limit(1);
    if (existing && (existing.sourceName !== listing.source || existing.sourceId !== listing.sourceId
      || existing.claimedAt !== null || (existing.claimStatus !== null && existing.claimStatus !== "unclaimed"))) {
      return "skipped" as const;
    }
    if (!existing) {
      // Only suppress exact duplicates; never overwrite a Google or OSM record.
      const [duplicate] = await tx.select({ placeId: restaurantsTable.placeId }).from(restaurantsTable)
        .where(and(ne(restaurantsTable.placeId, key),
          sql`lower(${restaurantsTable.name}) = lower(${listing.name})`,
          sql`lower(${restaurantsTable.address}) = lower(${listing.address})`,
          sql`lower(${restaurantsTable.city}) = lower(${listing.city})`)).limit(1);
      if (duplicate) return "skipped" as const;
    }
    const publicFields = {
      name: listing.name, address: listing.address, city: listing.city, region: listing.region,
      country: listing.country, currency: listing.currency, latitude: listing.latitude,
      longitude: listing.longitude, sourceAttribution: `${listing.attribution} Source: ${listing.sourceUrl}`,
      updatedAt: new Date(),
    };
    if (existing) {
      const changed = await tx.update(restaurantsTable).set(publicFields).where(and(
        eq(restaurantsTable.placeId, key), eq(restaurantsTable.sourceName, listing.source),
        eq(restaurantsTable.sourceId, listing.sourceId), isNull(restaurantsTable.claimedAt),
        sql`(${restaurantsTable.claimStatus} IS NULL OR ${restaurantsTable.claimStatus} = 'unclaimed')`,
      )).returning({ placeId: restaurantsTable.placeId });
      return changed.length ? "updated" as const : "skipped" as const;
    }
    const inserted = await tx.insert(restaurantsTable).values({
      placeId: key, sourceName: listing.source, sourceId: listing.sourceId,
      ...publicFields, published: true, publishedAt: new Date(),
      outreachStatus: "suppressed", enrichmentStatus: "skipped",
    }).onConflictDoNothing().returning({ placeId: restaurantsTable.placeId });
    return inserted.length ? "inserted" as const : "skipped" as const;
  });
}

export async function runGovernmentSource(source: GovernmentSource, now = new Date()) {
  if (!sourceIsPublishable(source) || process.env.NODE_ENV !== "production") return { status: "blocked" };
  const gate = await billingGate();
  if (!gate.ready) return { status: "blocked", reason: gate.reason };
  const [state] = await db.select().from(governmentImportSourcesTable)
    .where(eq(governmentImportSourcesTable.source, source)).limit(1);
  if (!state?.approved || state.paused || !state.reviewedAt) return { status: "blocked" };
  const runDay = now.toISOString().slice(0, 10);
  const [run] = await db.insert(governmentImportRunsTable).values({ source, runDay, status: "running" })
    .onConflictDoNothing().returning();
  if (!run) return { status: "already_ran" };
  let cursor = state.cursor;
  let scanned = 0, inserted = 0, updated = 0, skipped = 0;
  try {
    // One bounded page at a time, and never scan unbounded history to find
    // 100 eligible records. Save the cursor after each successful page.
    for (let pageNumber = 0; pageNumber < 5 && inserted < DAILY_NEW_LIMIT; pageNumber++) {
      // FSA page numbers are offsets into a fixed page size. Changing the
      // size as the daily allowance shrinks skips or repeats source records.
      const page = source === "FSA_UK" ? await fetchFsaBatch(cursor, 100) : await fetchFranceBatch(cursor, 100);
      scanned += page.scanned;
      let unfinishedPage = false;
      for (const listing of page.listings) {
        // Pause is rechecked before each write, including while a run is active.
        const [current] = await db.select({ paused: governmentImportSourcesTable.paused })
          .from(governmentImportSourcesTable).where(eq(governmentImportSourcesTable.source, source));
        if (current?.paused || !(await billingGate()).ready) throw new Error("Import paused or billing gate unavailable");
        if (inserted >= DAILY_NEW_LIMIT) {
          unfinishedPage = true;
          break;
        }
        const outcome = await saveGovernmentListing(listing);
        if (outcome === "inserted") inserted++;
        else if (outcome === "updated") updated++;
        else skipped++;
      }
      // Repeat an unfinished page on the next day. Upserts are idempotent,
      // so this does not lose eligible rows at the daily publication boundary.
      cursor = unfinishedPage ? cursor : page.nextCursor;
      await db.update(governmentImportSourcesTable).set({ cursor, updatedAt: new Date() })
        .where(eq(governmentImportSourcesTable.source, source));
      if (unfinishedPage || !cursor || !page.scanned) break;
    }
    await db.update(governmentImportRunsTable).set({
      status: "completed", scanned, inserted, updated, skipped, finishedAt: new Date(),
    }).where(eq(governmentImportRunsTable.id, run.id));
    return { status: "completed", scanned, inserted, updated, skipped };
  } catch (error) {
    await db.update(governmentImportRunsTable).set({
      status: "failed", scanned, inserted, updated, skipped,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown error", finishedAt: new Date(),
    }).where(eq(governmentImportRunsTable.id, run.id));
    throw error;
  }
}