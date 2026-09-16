import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface RestaurantProfile {
  id: string;
  name: string;
  cuisine: string | null;
  city: string;
  country: string;
  priceLevel: string | null;
  premium: boolean;
  rankingScore: number;
  description: string | null;
  phone: null;
  address: string;
  website: string | null;
  googleMapsUrl: string;
  rating: number | null;
  deliveryPlatforms: string[];
  openingHours: null;
  menu: [];
  photos: [];
  analytics: null;
  claimed: boolean;
  claimUrl: null;
}

export async function getRestaurantProfile(
  id: string,
): Promise<RestaurantProfile | null> {
  const placeId = id.trim();
  if (!placeId || placeId.length > 512) return null;
  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) return null;
  const cuisine = restaurant.cuisineTags[0] ?? null;

  return {
    id: restaurant.placeId,
    name: restaurant.name,
    cuisine,
    city: restaurant.city,
    country: "United Kingdom",
    priceLevel: restaurant.priceLevel,
    premium: restaurant.premium,
    rankingScore: calculateRanking({
      premium: restaurant.premium,
      score: restaurant.qualificationScore,
      popularity: restaurant.popularity,
      aiRelevanceBoost: restaurant.aiRelevanceBoost,
      city: restaurant.city,
      country: "United Kingdom",
      cuisine,
    }),
    description: restaurant.websiteDescription,
    phone: null,
    address: restaurant.address,
    website: restaurant.website,
    googleMapsUrl: restaurant.googleMapsUrl,
    rating: restaurant.rating,
    deliveryPlatforms: [],
    openingHours: null,
    menu: [],
    photos: [],
    analytics: null,
    claimed: restaurant.claimStatus !== null,
    claimUrl: null,
  };
}

export default { getRestaurantProfile };