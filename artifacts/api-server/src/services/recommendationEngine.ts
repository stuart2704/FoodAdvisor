import {
  db,
  analyticsEventsTable,
  restaurantsTable,
  type RestaurantRecord,
} from "@workspace/db";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface VisitorRecommendationProfile {
  preferredCities: string[];
  preferredCuisines: string[];
  recentClicks: string[];
}

export interface RecommendedRestaurant extends RestaurantRecord {
  rankingScore: number;
  finalScore: number;
}

function rankingFor(restaurant: RestaurantRecord): number {
  return calculateRanking({
    premium: restaurant.premium,
    score: restaurant.qualificationScore,
    popularity: restaurant.popularity,
    aiRelevanceBoost: restaurant.aiRelevanceBoost,
    city: restaurant.city,
    country: "United Kingdom",
    cuisine: restaurant.cuisineTags[0] ?? null,
  });
}

function includesInsensitive(values: string[], candidate: string): boolean {
  const normalised = candidate.toLocaleLowerCase("en-GB");
  return values.some(
    (value) => value.toLocaleLowerCase("en-GB") === normalised,
  );
}

export async function getRecommendedForVisitor(
  visitorProfile: VisitorRecommendationProfile,
): Promise<RecommendedRestaurant[]> {
  const restaurants = await db
    .select()
    .from(restaurantsTable)
    .orderBy(
      desc(restaurantsTable.premium),
      desc(restaurantsTable.rankingScore),
    )
    .limit(1_000);
  const recentClicks = new Set(visitorProfile.recentClicks);

  return restaurants
    .map((restaurant) => {
      const rankingScore = rankingFor(restaurant);
      let boost = 0;
      if (
        restaurant.cuisineTags.some((cuisine) =>
          includesInsensitive(visitorProfile.preferredCuisines, cuisine),
        )
      ) {
        boost += 15;
      }
      if (
        includesInsensitive(visitorProfile.preferredCities, restaurant.city)
      ) {
        boost += 10;
      }
      if (recentClicks.has(restaurant.placeId)) boost += 20;
      return { ...restaurant, rankingScore, finalScore: rankingScore + boost };
    })
    .sort(
      (left, right) =>
        Number(right.premium) - Number(left.premium) ||
        right.finalScore - left.finalScore ||
        (right.rating ?? 0) - (left.rating ?? 0) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 12);
}

export async function getSimilarRestaurants(
  restaurantId: string,
): Promise<Array<RestaurantRecord & { similarityScore: number }>> {
  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, restaurantId))
    .limit(1);
  if (!restaurant) throw new Error("Restaurant not found.");
  if (restaurant.cuisineTags.length === 0) return [];

  const candidates = await db
    .select()
    .from(restaurantsTable)
    .where(
      and(
        ne(restaurantsTable.placeId, restaurantId),
        eq(restaurantsTable.city, restaurant.city),
        sql`${restaurantsTable.cuisineTags} && ARRAY[${restaurant.cuisineTags[0]}]::text[]`,
      ),
    )
    .orderBy(
      desc(restaurantsTable.premium),
      desc(restaurantsTable.rankingScore),
      desc(restaurantsTable.rating),
    )
    .limit(8);

  return candidates.map((candidate) => ({
    ...candidate,
    similarityScore: 1,
  }));
}

export async function getTrending(city: string): Promise<RestaurantRecord[]> {
  const normalisedCity = city.trim();
  if (!normalisedCity || normalisedCity.length > 100) {
    throw new Error("A valid city is required.");
  }
  return db
    .select()
    .from(restaurantsTable)
    .where(
      and(
        eq(restaurantsTable.city, normalisedCity),
        gt(restaurantsTable.popularity, 20),
      ),
    )
    .orderBy(desc(restaurantsTable.popularity), restaurantsTable.name)
    .limit(10);
}

export async function getTopCuisine(
  cuisine: string,
): Promise<Array<RestaurantRecord & { rankingScore: number }>> {
  const normalisedCuisine = cuisine.trim();
  if (!normalisedCuisine || normalisedCuisine.length > 100) {
    throw new Error("A valid cuisine is required.");
  }
  const restaurants = await db
    .select()
    .from(restaurantsTable)
    .where(sql`exists (
      select 1
      from unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
      where lower(cuisine_tag) = lower(${normalisedCuisine})
    )`)
    .orderBy(
      desc(restaurantsTable.premium),
      desc(restaurantsTable.rankingScore),
    )
    .limit(200);

  return restaurants
    .map((restaurant) => ({
      ...restaurant,
      rankingScore: rankingFor(restaurant),
    }))
    .sort(
      (left, right) =>
        Number(right.premium) - Number(left.premium) ||
        right.rankingScore - left.rankingScore ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 10);
}

export async function getOwnerCompetitors(
  restaurantId: string,
): Promise<RestaurantRecord[]> {
  const relationships = await db
    .select({
      restaurantId: analyticsEventsTable.restaurantId,
      views: sql<number>`count(*)`.mapWith(Number),
    })
    .from(analyticsEventsTable)
    .where(
      and(
        eq(analyticsEventsTable.type, "profile_view"),
        sql`${analyticsEventsTable.metadata} ->> 'viewedWith' = ${restaurantId}`,
        sql`${analyticsEventsTable.metadata} ->> 'source' = 'server_profile'`,
      ),
    )
    .groupBy(analyticsEventsTable.restaurantId)
    .orderBy(desc(sql<number>`count(*)`))
    .limit(20);
  const ids = relationships
    .map((relationship) => relationship.restaurantId)
    .filter((id) => id !== restaurantId);
  if (ids.length === 0) return [];
  const restaurants = await db
    .select()
    .from(restaurantsTable)
    .where(inArray(restaurantsTable.placeId, ids));
  const relationshipOrder = new Map(
    relationships.map((relationship, index) => [
      relationship.restaurantId,
      index,
    ]),
  );
  return restaurants.sort(
    (left, right) =>
      (relationshipOrder.get(left.placeId) ?? Number.MAX_SAFE_INTEGER) -
      (relationshipOrder.get(right.placeId) ?? Number.MAX_SAFE_INTEGER),
  );
}