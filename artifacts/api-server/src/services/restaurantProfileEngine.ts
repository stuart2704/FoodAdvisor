import { db, restaurantMenuItemsTable, restaurantsTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { calculateRanking } from "./rankingEngine";

function deriveBadges(restaurant: {
  rating: number | null;
  priceLevel: string | null;
  popularity: number;
  cuisineTags: string[];
  types: string[];
}): string[] {
  const badges: string[] = [];
  const categories = new Set(
    [...restaurant.cuisineTags, ...restaurant.types].map((value) =>
      value.toLocaleLowerCase("en-GB"),
    ),
  );

  if (restaurant.popularity >= 50) badges.push("Popular");
  if (
    restaurant.rating !== null &&
    restaurant.rating > 4.5 &&
    ["italian_restaurant", "french_restaurant", "wine_bar"].some((category) =>
      categories.has(category),
    )
  ) {
    badges.push("Romantic");
  }
  if (restaurant.rating !== null && restaurant.rating >= 4.7) {
    badges.push("Top Rated");
  }
  if (
    restaurant.priceLevel === "PRICE_LEVEL_FREE" ||
    restaurant.priceLevel === "PRICE_LEVEL_INEXPENSIVE" ||
    restaurant.priceLevel === "PRICE_LEVEL_MODERATE"
  ) {
    badges.push("Budget Friendly");
  }
  if (
    restaurant.priceLevel === "PRICE_LEVEL_EXPENSIVE" ||
    restaurant.priceLevel === "PRICE_LEVEL_VERY_EXPENSIVE"
  ) {
    badges.push("Premium Dining");
  }

  return badges;
}

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
  bookingUrl: string | null;
  bookingProvider: string | null;
  offers: Array<{
    title: string;
    description: string;
    startDate: string;
    endDate: string;
  }>;
  events: Array<{
    title: string;
    description: string;
    date: string;
    time: string;
    price: string;
  }>;
  badges: string[];
  collections: Array<{
    id: string;
    title: string;
    description: string;
    city: string;
    restaurants: string[];
  }>;
  bestDishes: Array<{
    name: string;
    description: string;
    reason: string;
  }>;
  chef: {
    name: string | null;
    bio: string | null;
    signatureDishes: string[];
    awards: string[];
    philosophy: string | null;
    photo: string | null;
  };
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
    bookingUrl: null,
    bookingProvider: null,
    offers: [],
    events: [],
    badges: deriveBadges(restaurant),
    collections: [],
    bestDishes: [],
    chef: {
      name: null,
      bio: null,
      signatureDishes: [],
      awards: [],
      philosophy: null,
      photo: null,
    },
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