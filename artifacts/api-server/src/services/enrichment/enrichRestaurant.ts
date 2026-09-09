import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { detectCuisine, type CuisineDetectionResult } from "./detectCuisine";
import {
  extractWebsiteData,
  type WebsiteExtractionErrorCode,
} from "./extractWebsiteData";

export type RestaurantEnrichmentResult =
  | {
      ok: true;
      placeId: string;
      email: string | null;
      finalUrl: string | null;
      cuisine: CuisineDetectionResult;
    }
  | {
      ok: false;
      placeId: string;
      error: {
        code: "restaurant_not_found" | "website_missing" | WebsiteExtractionErrorCode;
        message: string;
      };
    };

export async function enrichRestaurant(
  placeId: string,
): Promise<RestaurantEnrichmentResult> {
  const [restaurant] = await db
    .select()
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) {
    return {
      ok: false,
      placeId,
      error: {
        code: "restaurant_not_found",
        message: "Restaurant was not found.",
      },
    };
  }

  const completedAt = new Date();
  const googleCuisine = detectCuisine({
    googlePlaceTypes: restaurant.types,
  });
  if (!restaurant.website) {
    const message = "Restaurant has no website to enrich.";
    await db
      .update(restaurantsTable)
      .set({
        enrichedAt: completedAt,
        enrichmentStatus: "failed",
        enrichmentFailure: message,
        cuisineTags: googleCuisine.cuisines,
        dietaryTags: googleCuisine.dietaryTags,
      })
      .where(eq(restaurantsTable.placeId, placeId));
    return {
      ok: false,
      placeId,
      error: { code: "website_missing", message },
    };
  }

  const website = await extractWebsiteData(restaurant.website);
  if (!website.ok) {
    await db
      .update(restaurantsTable)
      .set({
        enrichedAt: completedAt,
        enrichmentStatus: "failed",
        enrichmentFailure: website.error.message.slice(0, 500),
        cuisineTags: googleCuisine.cuisines,
        dietaryTags: googleCuisine.dietaryTags,
      })
      .where(eq(restaurantsTable.placeId, placeId));
    return { ok: false, placeId, error: website.error };
  }

  const cuisine = detectCuisine({
    websiteTitle: website.data.title,
    websiteDescription: website.data.description,
    googlePlaceTypes: restaurant.types,
  });
  await db
    .update(restaurantsTable)
    .set({
      websiteTitle: website.data.title,
      websiteDescription: website.data.description,
      cuisineTags: cuisine.cuisines,
      dietaryTags: cuisine.dietaryTags,
      enrichedAt: completedAt,
      enrichmentStatus: "succeeded",
      enrichmentFailure: null,
      // Never erase a previously stored address merely because the current
      // page does not expose one.
      ...(website.data.roleEmail
        ? {
            publicBusinessEmail: website.data.roleEmail,
            emailSourceUrl: website.data.finalUrl,
            emailDiscoveredAt: completedAt,
          }
        : {}),
    })
    .where(eq(restaurantsTable.placeId, placeId));
  return {
    ok: true,
    placeId,
    email: website.data.roleEmail ?? restaurant.publicBusinessEmail,
    finalUrl: website.data.finalUrl,
    cuisine,
  };
}