import { db, restaurantMenuItemsTable, restaurantsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

export interface RestaurantProfile {
  id: string;
  name: string;
  cuisine: string | null;
  city: string;
  region: string | null;
  country: string;
  globalRegion: string | null;
  slug: string | null;
  priceLevel: string | null;
  currency: string;
  premium: boolean;
  rankingScore: number;
  description: string | null;
  phone: null;
  address: string;
  website: string | null;
  deliveryUrl: string | null;
  googleMapsUrl: string;
  rating: number | null;
  lat: number | null;
  lng: number | null;
  deliveryPlatforms: string[];
  openingHours: null;
  menu: Array<{
    id: number;
    name: string;
    price: string | null;
    description: string | null;
    category: string;
  }>;
  photos: [];
  analytics: null;
  claimed: boolean;
  verified: boolean;
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
  const menu = await db
    .select({
      id: restaurantMenuItemsTable.id,
      name: restaurantMenuItemsTable.name,
      price: restaurantMenuItemsTable.price,
      description: restaurantMenuItemsTable.description,
      category: restaurantMenuItemsTable.category,
    })
    .from(restaurantMenuItemsTable)
    .where(eq(restaurantMenuItemsTable.restaurantId, restaurant.placeId))
    .orderBy(
      asc(restaurantMenuItemsTable.category),
      asc(restaurantMenuItemsTable.name),
    );
  const cuisine = restaurant.cuisineTags[0] ?? null;

  return {
    id: restaurant.placeId,
    name: restaurant.name,
    cuisine,
    city: restaurant.city,
    region: restaurant.region,
    country: restaurant.country ?? "",
    globalRegion: restaurant.globalRegion,
    slug: restaurant.slug,
    priceLevel: restaurant.priceLevel,
    currency: restaurant.currency,
    premium: restaurant.premium,
    rankingScore: calculateRanking({
      premium: restaurant.premium,
      score: restaurant.qualificationScore,
      popularity: restaurant.popularity,
      aiRelevanceBoost: restaurant.aiRelevanceBoost,
      city: restaurant.city,
      country: restaurant.country ?? "",
      cuisine,
    }),
    description:
      restaurant.websiteDescription ??
      `${restaurant.name} is a ${cuisine ?? "restaurant"} in ${[
        restaurant.city,
        restaurant.region,
        restaurant.country,
      ]
        .filter(Boolean)
        .join(", ")}.`,
    phone: null,
    address: restaurant.address,
    website: restaurant.website,
    deliveryUrl: restaurant.deliveryUrl,
    googleMapsUrl: restaurant.googleMapsUrl,
    rating: restaurant.rating,
    lat: restaurant.latitude,
    lng: restaurant.longitude,
    deliveryPlatforms: [],
    openingHours: null,
    menu,
    photos: [],
    analytics: null,
    claimed: restaurant.claimStatus !== null,
    verified: restaurant.claimedAt !== null,
    claimUrl: null,
  };
}

export default { getRestaurantProfile };