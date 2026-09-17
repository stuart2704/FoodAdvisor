import {
  analyticsEventsTable,
  db,
  restaurantBookingsTable,
  restaurantReviewsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const AnalyticsEventType = z.enum([
  "profile_view",
  "menu_view",
  "photo_view",
  "search_impression",
  "click",
  "claim_click",
  "premium_conversion",
  "portal_login",
]);

export type AnalyticsEventType = z.infer<typeof AnalyticsEventType>;

const forbiddenMetadataKey =
  /(?:email|phone|token|secret|password|authorization|cookie|session|ip|query|name|address)/i;

const AnalyticsMetadata = z
  .record(
    z.string().trim().min(1).max(50).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    z.union([
      z.string().trim().max(200),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine((value) => Object.keys(value).length <= 20, {
    message: "Analytics metadata contains too many fields.",
  })
  .refine(
    (value) => Object.keys(value).every((key) => !forbiddenMetadataKey.test(key)),
    { message: "Analytics metadata contains a sensitive field." },
  );

export interface RestaurantAnalytics {
  profileViews: number;
  menuViews: number;
  photoViews: number;
  searchImpressions: number;
  clicks: number;
  claimClicks: number;
  premiumConversions: number;
  bookings: number;
  reviews: number;
}

export async function logEvent(
  restaurantId: string,
  type: AnalyticsEventType,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  const id = z.string().trim().min(1).max(512).parse(restaurantId);
  const eventType = AnalyticsEventType.parse(type);
  const safeMetadata = AnalyticsMetadata.parse(metadata);
  await db.insert(analyticsEventsTable).values({
    restaurantId: id,
    type: eventType,
    metadata: safeMetadata,
  });
}

export async function getRestaurantAnalytics(
  id: string,
): Promise<RestaurantAnalytics> {
  const restaurantId = z.string().trim().min(1).max(512).parse(id);
  const [[totals], [bookingTotals], [reviewTotals]] = await Promise.all([
    db
    .select({
      profileViews: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'profile_view'
      )`.mapWith(Number),
      menuViews: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'menu_view'
      )`.mapWith(Number),
      photoViews: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'photo_view'
      )`.mapWith(Number),
      searchImpressions: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'search_impression'
      )`.mapWith(Number),
      clicks: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'click'
      )`.mapWith(Number),
      claimClicks: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'claim_click'
      )`.mapWith(Number),
      premiumConversions: sql<number>`count(*) filter (
        where ${analyticsEventsTable.type} = 'premium_conversion'
      )`.mapWith(Number),
    })
    .from(analyticsEventsTable)
      .where(eq(analyticsEventsTable.restaurantId, restaurantId)),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(restaurantBookingsTable)
      .where(eq(restaurantBookingsTable.restaurantId, restaurantId)),
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(restaurantReviewsTable)
      .where(eq(restaurantReviewsTable.restaurantId, restaurantId)),
  ]);

  return {
    profileViews: totals?.profileViews ?? 0,
    menuViews: totals?.menuViews ?? 0,
    photoViews: totals?.photoViews ?? 0,
    searchImpressions: totals?.searchImpressions ?? 0,
    clicks: totals?.clicks ?? 0,
    claimClicks: totals?.claimClicks ?? 0,
    premiumConversions: totals?.premiumConversions ?? 0,
    bookings: bookingTotals?.count ?? 0,
    reviews: reviewTotals?.count ?? 0,
  };
}

export default { logEvent, getRestaurantAnalytics };