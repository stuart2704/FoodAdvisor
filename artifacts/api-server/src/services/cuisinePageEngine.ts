import { createHash } from "node:crypto";
import { db, restaurantsTable, type RestaurantRecord } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface CuisinePageRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  tags: string[];
  rating: number | null;
  premium: boolean;
}

export interface CuisinePageData {
  cuisine: string;
  restaurantCount: number;
  top: CuisinePageRestaurant[];
  premium: CuisinePageRestaurant[];
  trending: CuisinePageRestaurant[];
  citySections: Record<string, CuisinePageRestaurant[]>;
  discovery: CuisinePageRestaurant[];
}

function toCuisinePageRestaurant(
  row: RestaurantRecord,
): CuisinePageRestaurant {
  return {
    id: row.placeId,
    name: row.name,
    city: row.city,
    country: "United Kingdom",
    cuisine: row.cuisineTags[0] ?? null,
    tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
    rating: row.rating,
    premium: row.premium,
  };
}

function dailyDiscoveryOrder(cuisine: string, placeId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update(`${day}:${cuisine}:${placeId}`)
    .digest("hex");
}

function displayCuisine(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toLocaleUpperCase("en-GB") +
        part.slice(1).toLocaleLowerCase("en-GB"),
    )
    .join(" ");
}

export async function getCuisinePage(
  cuisine: string,
): Promise<CuisinePageData> {
  const normalizedCuisine = cuisine.trim();
  if (!normalizedCuisine || normalizedCuisine.length > 100) {
    throw new Error("Invalid cuisine.");
  }
  const candidates = await db
    .select()
    .from(restaurantsTable)
    .where(sql`(
      exists (
        select 1 from unnest(${restaurantsTable.cuisineTags}) as cuisine_tag
        where lower(cuisine_tag) = lower(${normalizedCuisine})
      )
      or exists (
        select 1 from unnest(${restaurantsTable.types}) as place_type
        where lower(place_type) in (
          lower(${normalizedCuisine}),
          lower(${`${normalizedCuisine}_restaurant`})
        )
      )
    )`)
    .orderBy(
      desc(restaurantsTable.rankingScore),
      desc(restaurantsTable.rating),
      restaurantsTable.name,
    )
    .limit(500);
  const ranked = candidates
    .map((restaurant) => ({
      restaurant,
      rankingScore: calculateRanking({
        premium: restaurant.premium,
        score: restaurant.qualificationScore,
        popularity: restaurant.popularity,
        aiRelevanceBoost: restaurant.aiRelevanceBoost,
        city: restaurant.city,
        country: "United Kingdom",
        cuisine: restaurant.cuisineTags[0] ?? null,
      }),
    }))
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .map(({ restaurant }) => restaurant);
  const canonicalCuisine =
    ranked
      .flatMap((restaurant) => restaurant.cuisineTags)
      .find(
        (tag) =>
          tag.toLocaleLowerCase("en-GB") ===
          normalizedCuisine.toLocaleLowerCase("en-GB"),
      ) ?? displayCuisine(normalizedCuisine);
  const cities = [...new Set(ranked.map((restaurant) => restaurant.city))]
    .slice(0, 12);
  const citySections = Object.fromEntries(
    cities.map((city) => [
      city,
      ranked
        .filter((restaurant) => restaurant.city === city)
        .slice(0, 10)
        .map(toCuisinePageRestaurant),
    ]),
  );

  return {
    cuisine: canonicalCuisine,
    restaurantCount: ranked.length,
    top: ranked.slice(0, 20).map(toCuisinePageRestaurant),
    premium: ranked
      .filter((restaurant) => restaurant.premium)
      .slice(0, 10)
      .map(toCuisinePageRestaurant),
    trending: ranked
      .filter((restaurant) => restaurant.popularity > 15)
      .slice(0, 10)
      .map(toCuisinePageRestaurant),
    citySections,
    discovery: [...ranked]
      .sort((left, right) =>
        dailyDiscoveryOrder(canonicalCuisine, left.placeId).localeCompare(
          dailyDiscoveryOrder(canonicalCuisine, right.placeId),
        ),
      )
      .slice(0, 12)
      .map(toCuisinePageRestaurant),
  };
}

export default { getCuisinePage };