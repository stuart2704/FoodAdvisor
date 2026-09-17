import { createHash } from "node:crypto";
import { db, restaurantsTable, type RestaurantRecord } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface CityPageRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  tags: string[];
  rating: number | null;
  premium: boolean;
}

export interface CityPageData {
  city: string;
  country: string;
  restaurantCount: number;
  top: CityPageRestaurant[];
  trending: CityPageRestaurant[];
  premium: CityPageRestaurant[];
  cuisineSections: Record<string, CityPageRestaurant[]>;
  discovery: CityPageRestaurant[];
}

function toCityPageRestaurant(row: RestaurantRecord): CityPageRestaurant {
  return {
    id: row.placeId,
    name: row.name,
    city: row.city,
    country: row.country ?? "",
    cuisine: row.cuisineTags[0] ?? null,
    tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
    rating: row.rating,
    premium: row.premium,
  };
}

function dailyDiscoveryOrder(city: string, placeId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${day}:${city}:${placeId}`)
    .digest("hex");
}

export async function getCityPage(city: string): Promise<CityPageData> {
  const normalizedCity = city.trim();
  if (!normalizedCity || normalizedCity.length > 100) {
    throw new Error("Invalid city.");
  }
  const candidates = await db
    .select()
    .from(restaurantsTable)
    .where(
      sql`lower(${restaurantsTable.city}) = lower(${normalizedCity})`,
    )
    .orderBy(
      desc(restaurantsTable.rankingScore),
      desc(restaurantsTable.rating),
      restaurantsTable.name,
    )
    .limit(500);
  const restaurants = candidates
    .map((restaurant) => ({
      restaurant,
      rankingScore: calculateRanking({
        premium: restaurant.premium,
        score: restaurant.qualificationScore,
        popularity: restaurant.popularity,
        aiRelevanceBoost: restaurant.aiRelevanceBoost,
        city: restaurant.city,
        country: restaurant.country ?? "",
        cuisine: restaurant.cuisineTags[0] ?? null,
      }),
    }))
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .map(({ restaurant }) => restaurant);
  const canonicalCity = restaurants[0]?.city ?? normalizedCity;
  const cuisines = [
    ...new Set(
      restaurants.flatMap((restaurant) => restaurant.cuisineTags),
    ),
  ].slice(0, 8);
  const cuisineSections = Object.fromEntries(
    cuisines.map((cuisine) => [
      cuisine,
      restaurants
        .filter((restaurant) =>
          restaurant.cuisineTags.some(
            (tag) =>
              tag.toLocaleLowerCase("en-GB") ===
              cuisine.toLocaleLowerCase("en-GB"),
          ),
        )
        .slice(0, 10)
        .map(toCityPageRestaurant),
    ]),
  );

  return {
    city: canonicalCity,
    country: "United Kingdom",
    restaurantCount: restaurants.length,
    top: restaurants.slice(0, 20).map(toCityPageRestaurant),
    trending: restaurants
      .filter((restaurant) => restaurant.popularity > 15)
      .slice(0, 10)
      .map(toCityPageRestaurant),
    premium: restaurants
      .filter((restaurant) => restaurant.premium)
      .slice(0, 10)
      .map(toCityPageRestaurant),
    cuisineSections,
    discovery: [...restaurants]
      .sort((left, right) =>
        dailyDiscoveryOrder(canonicalCity, left.placeId).localeCompare(
          dailyDiscoveryOrder(canonicalCity, right.placeId),
        ),
      )
      .slice(0, 12)
      .map(toCityPageRestaurant),
  };
}

export const getCityPageData = getCityPage;

export default { getCityPage, getCityPageData };