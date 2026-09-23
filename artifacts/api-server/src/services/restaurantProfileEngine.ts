import {
  db,
  restaurantEventsTable,
  restaurantMenuItemsTable,
  restaurantOffersTable,
  restaurantCollectionMembersTable,
  restaurantCollectionsTable,
  restaurantChefProfilesTable,
  restaurantsTable,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
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
    verifiedAt: Date | null;
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
  const today = new Date().toISOString().slice(0, 10);
  const [menu, chefRow, offers, events, collectionRows] = await Promise.all([
    db
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
      ),
    db
      .select()
      .from(restaurantChefProfilesTable)
      .where(
        and(
          eq(restaurantChefProfilesTable.restaurantId, restaurant.placeId),
          eq(restaurantChefProfilesTable.moderationStatus, "approved"),
        ),
      )
      .limit(1),
    restaurant.claimedAt
      ? db
          .select({
            title: restaurantOffersTable.title,
            description: restaurantOffersTable.description,
            startDate: restaurantOffersTable.startDate,
            endDate: restaurantOffersTable.endDate,
          })
          .from(restaurantOffersTable)
          .where(
            and(
              eq(restaurantOffersTable.restaurantId, restaurant.placeId),
              lte(restaurantOffersTable.startDate, today),
              gte(restaurantOffersTable.endDate, today),
            ),
          )
          .orderBy(asc(restaurantOffersTable.endDate))
      : Promise.resolve([]),
    restaurant.claimedAt
      ? db
          .select({
            title: restaurantEventsTable.title,
            description: restaurantEventsTable.description,
            date: restaurantEventsTable.eventDate,
            time: restaurantEventsTable.eventTime,
            price: restaurantEventsTable.price,
          })
          .from(restaurantEventsTable)
          .where(
            and(
              eq(restaurantEventsTable.restaurantId, restaurant.placeId),
              gte(restaurantEventsTable.eventDate, today),
            ),
          )
          .orderBy(
            asc(restaurantEventsTable.eventDate),
            asc(restaurantEventsTable.eventTime),
          )
      : Promise.resolve([]),
    db
      .select({
        id: restaurantCollectionsTable.id,
        title: restaurantCollectionsTable.title,
        description: restaurantCollectionsTable.description,
        city: restaurantCollectionsTable.city,
        restaurantId: restaurantCollectionMembersTable.restaurantId,
      })
      .from(restaurantCollectionMembersTable)
      .innerJoin(
        restaurantCollectionsTable,
        eq(
          restaurantCollectionMembersTable.collectionId,
          restaurantCollectionsTable.id,
        ),
      )
      .where(
        inArray(
          restaurantCollectionMembersTable.collectionId,
          db
            .select({ id: restaurantCollectionMembersTable.collectionId })
            .from(restaurantCollectionMembersTable)
            .where(
              eq(
                restaurantCollectionMembersTable.restaurantId,
                restaurant.placeId,
              ),
            ),
        ),
      )
      .orderBy(
        asc(restaurantCollectionsTable.title),
        asc(restaurantCollectionMembersTable.position),
      ),
  ]);
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
    bookingUrl:
      restaurant.claimedAt && restaurant.bookingStatus === "approved"
        ? restaurant.bookingUrl
        : null,
    bookingProvider:
      restaurant.claimedAt && restaurant.bookingStatus === "approved"
        ? restaurant.bookingProvider
        : null,
    offers,
    events,
    badges: deriveBadges(restaurant),
    collections: Array.from(
      collectionRows.reduce((collections, row) => {
        const collection = collections.get(row.id) ?? {
          id: row.id,
          title: row.title,
          description: row.description,
          city: row.city,
          restaurants: [],
        };
        collection.restaurants.push(row.restaurantId);
        collections.set(row.id, collection);
        return collections;
      }, new Map<string, RestaurantProfile["collections"][number]>()),
      ([, collection]) => collection,
    ),
    bestDishes: [],
    chef: chefRow[0]
      ? {
          name: chefRow[0].name,
          bio: chefRow[0].bio,
          signatureDishes: chefRow[0].signatureDishes,
          awards: chefRow[0].awards,
          philosophy: chefRow[0].philosophy,
          photo: chefRow[0].photoObjectPath
            ? `/api/storage/objects/chef/${chefRow[0].photoObjectPath.split("/").at(-1)}`
            : null,
          verifiedAt: chefRow[0].verifiedAt,
        }
      : {
          name: null,
          bio: null,
          signatureDishes: [],
          awards: [],
          philosophy: null,
          photo: null,
          verifiedAt: null,
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