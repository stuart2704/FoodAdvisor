import { analyticsEventsTable, dailyAnalyticsTable, db } from "@workspace/db";
import { and, gte, lt, sql } from "drizzle-orm";

export default async function analyticsRollup(
  day?: Date,
): Promise<{ date: string }> {
  const target = day ? new Date(day) : new Date(Date.now() - 24 * 60 * 60 * 1_000);
  if (Number.isNaN(target.getTime())) {
    throw new Error("A valid analytics rollup date is required.");
  }
  const date = target.toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  const [totals] = await db
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
    .where(
      and(
        gte(analyticsEventsTable.createdAt, start),
        lt(analyticsEventsTable.createdAt, end),
      ),
    );
  const values = {
    date,
    profileViews: totals?.profileViews ?? 0,
    menuViews: totals?.menuViews ?? 0,
    photoViews: totals?.photoViews ?? 0,
    searchImpressions: totals?.searchImpressions ?? 0,
    clicks: totals?.clicks ?? 0,
    claimClicks: totals?.claimClicks ?? 0,
    premiumConversions: totals?.premiumConversions ?? 0,
  };
  await db
    .insert(dailyAnalyticsTable)
    .values(values)
    .onConflictDoUpdate({
      target: dailyAnalyticsTable.date,
      set: {
        profileViews: values.profileViews,
        menuViews: values.menuViews,
        photoViews: values.photoViews,
        searchImpressions: values.searchImpressions,
        clicks: values.clicks,
        claimClicks: values.claimClicks,
        premiumConversions: values.premiumConversions,
      },
    });
  return { date };
}