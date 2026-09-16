import {
  db,
  ownerProfilesTable,
  visitorProfilesTable,
  type RecentProfileSearch,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { HomepageData } from "./homepageEngine";
import {
  generateOwnerAnalyticsInsight,
  type OwnerAnalyticsInsight,
} from "./ownerAnalyticsInsight";
import type { RestaurantAnalytics } from "./analyticsEngine";
import { createHash } from "node:crypto";

const ProfileId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const Preference = z.string().trim().min(1).max(80);
const VisitorEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search"),
    city: Preference.optional(),
    cuisine: Preference.optional(),
    priceLevel: Preference.optional(),
  }),
  z.object({
    type: z.literal("click"),
    restaurantId: z.string().trim().min(1).max(512),
  }),
  z.object({
    type: z.literal("section"),
    section: Preference,
  }),
]);

export type VisitorProfileEvent = z.infer<typeof VisitorEvent>;

export async function getVisitorProfile(visitorId: string) {
  const id = ProfileId.parse(visitorId);
  const [profile] = await db
    .select()
    .from(visitorProfilesTable)
    .where(eq(visitorProfilesTable.id, id))
    .limit(1);
  return profile ?? null;
}

function appendUnique(values: string[], value: string | undefined, limit = 20) {
  if (!value) return values.slice(-limit);
  const normalised = value.toLocaleLowerCase("en-GB");
  return [
    ...values.filter(
      (item) => item.toLocaleLowerCase("en-GB") !== normalised,
    ),
    value,
  ].slice(-limit);
}

export async function updateVisitorProfile(
  visitorId: string,
  event: VisitorProfileEvent,
) {
  const id = ProfileId.parse(visitorId);
  const input = VisitorEvent.parse(event);
  return db.transaction(async (tx) => {
    await tx
      .insert(visitorProfilesTable)
      .values({ id })
      .onConflictDoNothing();
    const [profile] = await tx
      .select()
      .from(visitorProfilesTable)
      .where(eq(visitorProfilesTable.id, id))
      .limit(1);
    if (!profile) throw new Error("Visitor profile could not be created.");

    let preferredCities = profile.preferredCities;
    let preferredCuisines = profile.preferredCuisines;
    let preferredPriceLevels = profile.preferredPriceLevels;
    let recentSearches = profile.recentSearches;
    let recentClicks = profile.recentClicks;
    let lastSeenSections = profile.lastSeenSections;

    if (input.type === "search") {
      const search: RecentProfileSearch = {
        ...(input.city ? { city: input.city } : {}),
        ...(input.cuisine ? { cuisine: input.cuisine } : {}),
        ...(input.priceLevel ? { priceLevel: input.priceLevel } : {}),
        searchedAt: new Date().toISOString(),
      };
      recentSearches = [...recentSearches, search].slice(-20);
      preferredCities = appendUnique(preferredCities, input.city);
      preferredCuisines = appendUnique(preferredCuisines, input.cuisine);
      preferredPriceLevels = appendUnique(
        preferredPriceLevels,
        input.priceLevel,
      );
    } else if (input.type === "click") {
      recentClicks = appendUnique(recentClicks, input.restaurantId);
    } else {
      lastSeenSections = appendUnique(lastSeenSections, input.section);
    }

    const [updated] = await tx
      .update(visitorProfilesTable)
      .set({
        preferredCities,
        preferredCuisines,
        preferredPriceLevels,
        recentSearches,
        recentClicks,
        lastSeenSections,
        updatedAt: new Date(),
      })
      .where(eq(visitorProfilesTable.id, id))
      .returning();
    if (!updated) throw new Error("Visitor profile could not be updated.");
    return updated;
  });
}

function orderSections<T>(
  sections: Record<string, T>,
  preferences: string[],
): Record<string, T> {
  const order = new Map(
    preferences.map((preference, index) => [
      preference.toLocaleLowerCase("en-GB"),
      index,
    ]),
  );
  return Object.fromEntries(
    Object.entries(sections)
      .map(([key, value], index) => ({ key, value, index }))
      .sort((left, right) => {
        const leftOrder =
          order.get(left.key.toLocaleLowerCase("en-GB")) ??
          Number.MAX_SAFE_INTEGER;
        const rightOrder =
          order.get(right.key.toLocaleLowerCase("en-GB")) ??
          Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.index - right.index;
      })
      .map(({ key, value }) => [key, value]),
  );
}

export function personaliseHomepage(
  baseData: HomepageData,
  profile: {
    preferredCities: string[];
    preferredCuisines: string[];
  },
): HomepageData {
  return {
    ...baseData,
    cityHighlights: orderSections(
      baseData.cityHighlights,
      profile.preferredCities,
    ),
    cuisineHighlights: orderSections(
      baseData.cuisineHighlights,
      profile.preferredCuisines,
    ),
  };
}

export function personaliseSearch<
  T extends { id: string; rankingScore: number; premium?: boolean },
>(results: T[], profile: { recentClicks: string[] }): T[] {
  const clicked = new Set(profile.recentClicks);
  return [...results].sort((left, right) => {
    const premiumOrder = Number(Boolean(right.premium)) - Number(Boolean(left.premium));
    if (premiumOrder !== 0) return premiumOrder;
    const leftScore = left.rankingScore + (clicked.has(left.id) ? 10 : 0);
    const rightScore = right.rankingScore + (clicked.has(right.id) ? 10 : 0);
    return rightScore - leftScore;
  });
}

export async function recordOwnerLogin(restaurantId: string): Promise<void> {
  await db
    .insert(ownerProfilesTable)
    .values({ restaurantId, lastLogin: new Date() })
    .onConflictDoUpdate({
      target: ownerProfilesTable.restaurantId,
      set: { lastLogin: new Date(), updatedAt: new Date() },
    });
}

export async function updateOwnerProfile(
  restaurantId: string,
  analytics: RestaurantAnalytics,
  onboardingCompletionScore: number,
) {
  const entries = Object.entries(analytics).sort((a, b) => b[1] - a[1]);
  const strongest = entries.filter(([, value]) => value > 0).slice(0, 2);
  const weakest = entries.filter(([, value]) => value === 0).slice(0, 2);
  const readiness = premiumReadiness(analytics);
  const values = {
    restaurantId,
    mostViewedAnalytics: Object.fromEntries(entries.slice(0, 3)),
    strongAreas: strongest.map(([name]) => name),
    weakAreas: weakest.map(([name]) => name),
    premiumReadinessScore: readiness,
    onboardingCompletionScore: Math.max(
      0,
      Math.min(100, Math.round(onboardingCompletionScore)),
    ),
    updatedAt: new Date(),
  };
  const [profile] = await db
    .insert(ownerProfilesTable)
    .values(values)
    .onConflictDoUpdate({
      target: ownerProfilesTable.restaurantId,
      set: values,
    })
    .returning();
  return profile;
}

export async function generateOwnerInsights(
  analytics: RestaurantAnalytics,
  context?: { restaurantId?: string; premium?: boolean },
): Promise<OwnerAnalyticsInsight> {
  const restaurantId =
    context?.restaurantId ??
    `aggregate-${createHash("sha256")
      .update(JSON.stringify(analytics))
      .digest("hex")
      .slice(0, 32)}`;
  return generateOwnerAnalyticsInsight(
    restaurantId,
    analytics,
    context?.premium ?? false,
  );
}

export function premiumReadiness(
  analytics: Pick<
    RestaurantAnalytics,
    "profileViews" | "searchImpressions" | "clicks" | "menuViews"
  >,
): number {
  let score = 0;
  if (analytics.profileViews > 300) score += 30;
  if (analytics.searchImpressions > 500) score += 30;
  if (analytics.clicks > 100) score += 20;
  if (analytics.menuViews > 50) score += 20;
  return score;
}