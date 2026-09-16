import {
  analyticsEventsTable,
  db,
  globalMetricsSnapshotsTable,
  restaurantsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

export interface GlobalMetricsSnapshot {
  id?: number;
  totalRestaurants: number;
  totalClaimed: number;
  totalPremium: number;
  totalVisits: number;
  totalClicks: number;
  totalSearchImpressions: number;
  totalClaimConversions: number;
  totalOnboardingCompletions: number;
  totalPremiumConversions: number;
  funnelOutreach: number;
  funnelFollowUp: number;
  funnelEscalation: number;
  funnelClaim: number;
  funnelOnboarding: number;
  funnelPortalLogin: number;
  funnelPremium: number;
  topCities: Record<string, number>;
  topCuisines: Record<string, number>;
  mrr: number;
  arr: number;
  churnRate: number;
  updatedAt: string;
}

export async function getCurrentGlobalMetrics(): Promise<GlobalMetricsSnapshot> {
  const [[restaurants], [events], cityRows, cuisineResult] = await Promise.all([
    db
      .select({
        totalRestaurants: sql<number>`count(*)`.mapWith(Number),
        totalClaimed: sql<number>`count(*) filter (
          where ${restaurantsTable.claimStatus} is not null
        )`.mapWith(Number),
        totalPremium: sql<number>`count(*) filter (
          where ${restaurantsTable.premium}
        )`.mapWith(Number),
        onboarding: sql<number>`count(*) filter (
          where ${restaurantsTable.onboardedAt} is not null
        )`.mapWith(Number),
        outreach: sql<number>`count(*) filter (
          where ${restaurantsTable.outreachCount} > 0
        )`.mapWith(Number),
        followUp: sql<number>`count(*) filter (
          where ${restaurantsTable.outreachCount} > 1
        )`.mapWith(Number),
        escalation: sql<number>`count(*) filter (
          where ${restaurantsTable.escalatedAt} is not null
        )`.mapWith(Number),
        everPremium: sql<number>`count(*) filter (
          where ${restaurantsTable.premiumSince} is not null
        )`.mapWith(Number),
        cancelledPremium: sql<number>`count(*) filter (
          where ${restaurantsTable.premiumCancelledAt} is not null
        )`.mapWith(Number),
      })
      .from(restaurantsTable),
    db
      .select({
        visits: sql<number>`count(*) filter (
          where ${analyticsEventsTable.type} = 'profile_view'
        )`.mapWith(Number),
        clicks: sql<number>`count(*) filter (
          where ${analyticsEventsTable.type} = 'click'
        )`.mapWith(Number),
        searchImpressions: sql<number>`count(*) filter (
          where ${analyticsEventsTable.type} = 'search_impression'
        )`.mapWith(Number),
        premiumConversions: sql<number>`count(*) filter (
          where ${analyticsEventsTable.type} = 'premium_conversion'
        )`.mapWith(Number),
        portalLogins: sql<number>`count(distinct ${analyticsEventsTable.restaurantId}) filter (
          where ${analyticsEventsTable.type} = 'portal_login'
        )`.mapWith(Number),
      })
      .from(analyticsEventsTable),
    db
      .select({
        city: restaurantsTable.city,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(restaurantsTable)
      .groupBy(restaurantsTable.city)
      .orderBy(sql`count(*) desc`, restaurantsTable.city)
      .limit(10),
    db.execute<{ cuisine: string; count: number }>(sql`
      select cuisine, count(*)::int as count
      from ${restaurantsTable},
        unnest(${restaurantsTable.cuisineTags}) as cuisine
      where cuisine <> ''
      group by cuisine
      order by count(*) desc, cuisine
      limit 10
    `),
  ]);
  const totalPremium = restaurants?.totalPremium ?? 0;
  const everPremium = restaurants?.everPremium ?? 0;
  const cancelledPremium = restaurants?.cancelledPremium ?? 0;
  const mrr = totalPremium * 99;

  return {
    totalRestaurants: restaurants?.totalRestaurants ?? 0,
    totalClaimed: restaurants?.totalClaimed ?? 0,
    totalPremium,
    totalVisits: events?.visits ?? 0,
    totalClicks: events?.clicks ?? 0,
    totalSearchImpressions: events?.searchImpressions ?? 0,
    totalClaimConversions: restaurants?.totalClaimed ?? 0,
    totalOnboardingCompletions: restaurants?.onboarding ?? 0,
    totalPremiumConversions: events?.premiumConversions ?? 0,
    funnelOutreach: restaurants?.outreach ?? 0,
    funnelFollowUp: restaurants?.followUp ?? 0,
    funnelEscalation: restaurants?.escalation ?? 0,
    funnelClaim: restaurants?.totalClaimed ?? 0,
    funnelOnboarding: restaurants?.onboarding ?? 0,
    funnelPortalLogin: events?.portalLogins ?? 0,
    funnelPremium: totalPremium,
    topCities: Object.fromEntries(cityRows.map((row) => [row.city, row.count])),
    topCuisines: Object.fromEntries(
      cuisineResult.rows.map((row) => [row.cuisine, Number(row.count)]),
    ),
    mrr,
    arr: mrr * 12,
    churnRate:
      everPremium > 0
        ? Number(((cancelledPremium / everPremium) * 100).toFixed(1))
        : 0,
    updatedAt: new Date().toISOString(),
  };
}

export default async function updateGlobalMetrics(): Promise<GlobalMetricsSnapshot> {
  const metrics = await getCurrentGlobalMetrics();
  const [snapshot] = await db
    .insert(globalMetricsSnapshotsTable)
    .values({
      totalRestaurants: metrics.totalRestaurants,
      totalClients: metrics.totalClaimed,
      totalPremiumClients: metrics.totalPremium,
      totalVisits: metrics.totalVisits,
      totalClicks: metrics.totalClicks,
      totalSearchImpressions: metrics.totalSearchImpressions,
      totalClaimConversions: metrics.totalClaimConversions,
      totalOnboardingCompletions: metrics.totalOnboardingCompletions,
      totalPremiumConversions: metrics.totalPremiumConversions,
      funnelOutreach: metrics.funnelOutreach,
      funnelFollowUp: metrics.funnelFollowUp,
      funnelEscalation: metrics.funnelEscalation,
      funnelClaim: metrics.funnelClaim,
      funnelOnboarding: metrics.funnelOnboarding,
      funnelPortalLogin: metrics.funnelPortalLogin,
      funnelPremium: metrics.funnelPremium,
      topCities: metrics.topCities,
      topCuisines: metrics.topCuisines,
      mrr: metrics.mrr,
      arr: metrics.arr,
      churnRate: metrics.churnRate,
    })
    .returning({ id: globalMetricsSnapshotsTable.id });
  return { ...metrics, id: snapshot?.id };
}