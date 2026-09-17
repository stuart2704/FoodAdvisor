import { db, restaurantsTable, type RestaurantRecord } from "@workspace/db";
import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface HomepageRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  tags: string[];
  rating: number | null;
  premium: boolean;
  lat: number | null;
  lng: number | null;
}

export interface HomepageData {
  featured: HomepageRestaurant[];
  trending: HomepageRestaurant[];
  premium: HomepageRestaurant[];
  cityHighlights: Record<string, HomepageRestaurant[]>;
  cuisineHighlights: Record<string, HomepageRestaurant[]>;
  globalDiscovery: HomepageRestaurant[];
}

function toHomepageRestaurant(row: RestaurantRecord): HomepageRestaurant {
  return {
    id: row.placeId,
    name: row.name,
    city: row.city,
    country: "United Kingdom",
    cuisine: row.cuisineTags[0] ?? null,
    tags: [...new Set([...row.cuisineTags, ...row.dietaryTags])],
    rating: row.rating,
    premium: row.premium,
    lat: row.latitude,
    lng: row.longitude,
  };
}

function dailyDiscoveryOrder(placeId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}:${placeId}`).digest("hex");
}

export async function getHomepageData(): Promise<HomepageData> {
  const restaurants = await db
    .select()
    .from(restaurantsTable)
    .orderBy(
      desc(restaurantsTable.rankingScore),
      desc(restaurantsTable.rating),
      restaurantsTable.name,
    )
    .limit(1_000);
  const ranked = restaurants
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
    .sort((left, right) => right.rankingScore - left.rankingScore);
  const rows = ranked.map(({ restaurant }) => restaurant);

  const cities = [
    "London",
    "Cardiff",
    "Manchester",
    "New York",
    "Tokyo",
    "Paris",
  ];
  const cityHighlights = Object.fromEntries(
    cities.map((city) => [
      city,
      rows
        .filter((restaurant) => restaurant.city === city)
        .slice(0, 5)
        .map(toHomepageRestaurant),
    ]),
  );
  const cuisines = ["Italian", "Japanese", "Indian", "Chinese", "Mexican"];
  const cuisineHighlights = Object.fromEntries(
    cuisines.map((cuisine) => [
      cuisine,
      rows
        .filter((restaurant) =>
          restaurant.cuisineTags.some(
            (tag) => tag.toLocaleLowerCase("en-GB") ===
              cuisine.toLocaleLowerCase("en-GB"),
          ),
        )
        .slice(0, 5)
        .map(toHomepageRestaurant),
    ]),
  );

  return {
    featured: rows.slice(0, 10).map(toHomepageRestaurant),
    trending: rows
      .filter((restaurant) => restaurant.popularity > 20)
      .slice(0, 10)
      .map(toHomepageRestaurant),
    premium: rows
      .filter((restaurant) => restaurant.premium)
      .slice(0, 10)
      .map(toHomepageRestaurant),
    cityHighlights,
    cuisineHighlights,
    globalDiscovery: [...rows]
      .sort((left, right) =>
        dailyDiscoveryOrder(left.placeId).localeCompare(
          dailyDiscoveryOrder(right.placeId),
        ),
      )
      .slice(0, 12)
      .map(toHomepageRestaurant),
  };
}

export const getHomepageSections = getHomepageData;

export default { getHomepageData, getHomepageSections };