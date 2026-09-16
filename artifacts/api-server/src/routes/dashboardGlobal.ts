import {
  aiUsageEventsTable,
  db,
  outreachAuditTable,
  restaurantsTable,
} from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { getWatchHealthSchedulerStatus } from "../cron/watchHealthCheck";
import { getWatchRenewalSchedulerStatus } from "../cron/watchRenewal";
import { computeDailyHealthScore } from "../health/scraperHealth";
import { adminOnly } from "../middleware/adminOnly";
import { getUsdToGbpRate } from "../services/aiUsage";

const router: IRouter = Router();

router.get("/global", adminOnly, async (req, res) => {
  try {
    const [[restaurantTotals], [outreachTotals], [aiTotals], cities] =
      await Promise.all([
        db
          .select({
            restaurants: sql<number>`count(*)`.mapWith(Number),
            cities:
              sql<number>`count(distinct ${restaurantsTable.city})`.mapWith(Number),
            newToday: sql<number>`count(*) filter (
              where ${restaurantsTable.importedAt} >= date_trunc('day', now())
            )`.mapWith(Number),
            newThisWeek: sql<number>`count(*) filter (
              where ${restaurantsTable.importedAt} >= date_trunc('week', now())
            )`.mapWith(Number),
            newThisMonth: sql<number>`count(*) filter (
              where ${restaurantsTable.importedAt} >= date_trunc('month', now())
            )`.mapWith(Number),
            completedClaims:
              sql<number>`count(*) filter (where ${restaurantsTable.claimedAt} is not null)`.mapWith(Number),
            lastUpdated: sql<Date | null>`max(${restaurantsTable.importedAt})`,
          })
          .from(restaurantsTable),
        db
          .select({
            sent: sql<number>`count(*)`.mapWith(Number),
          })
          .from(outreachAuditTable)
          .where(eq(outreachAuditTable.event, "sent")),
        db
          .select({
            dailyCalls: sql<number>`count(*) filter (
              where ${aiUsageEventsTable.createdAt} >= date_trunc('day', now())
            )`.mapWith(Number),
            monthlyCalls: sql<number>`count(*) filter (
              where ${aiUsageEventsTable.createdAt} >= date_trunc('month', now())
            )`.mapWith(Number),
            totalTokens:
              sql<number>`coalesce(sum(${aiUsageEventsTable.totalTokens}), 0)`.mapWith(Number),
            estimatedCostMicros:
              sql<number>`coalesce(sum(${aiUsageEventsTable.estimatedCostMicros}), 0)`.mapWith(Number),
          })
          .from(aiUsageEventsTable),
        db
          .select({
            city: restaurantsTable.city,
            restaurants: sql<number>`count(*)`.mapWith(Number),
            completedClaims:
              sql<number>`count(*) filter (where ${restaurantsTable.claimedAt} is not null)`.mapWith(Number),
          })
          .from(restaurantsTable)
          .groupBy(restaurantsTable.city)
          .orderBy(desc(sql<number>`count(*)`), restaurantsTable.city)
          .limit(50),
      ]);

    const schedulers = [
      getWatchHealthSchedulerStatus(),
      getWatchRenewalSchedulerStatus(),
    ];
    const conversion = getUsdToGbpRate();
    const restaurants = restaurantTotals?.restaurants ?? 0;
    const completedClaims = restaurantTotals?.completedClaims ?? 0;
    const topCities = Object.fromEntries(
      cities.map((city) => [city.city, city.restaurants]),
    );
    const topCountries =
      restaurants > 0 ? { "United Kingdom": restaurants } : {};
    const lastUpdated = restaurantTotals?.lastUpdated;
    const lastUpdatedIso = lastUpdated
      ? new Date(lastUpdated).toISOString()
      : null;

    res.json({
      success: true,
      totalRestaurants: restaurants,
      countries: restaurants > 0 ? 1 : 0,
      cities: restaurantTotals?.cities ?? 0,
      newToday: restaurantTotals?.newToday ?? 0,
      newThisWeek: restaurantTotals?.newThisWeek ?? 0,
      newThisMonth: restaurantTotals?.newThisMonth ?? 0,
      topCountries,
      topCities,
      lastUpdated: lastUpdatedIso,
      overview: {
        restaurants,
        outreachSent: outreachTotals?.sent ?? 0,
        completedClaims,
        claimConversionRate: 0,
        dailyAiCalls: aiTotals?.dailyCalls ?? 0,
        monthlyAiCalls: aiTotals?.monthlyCalls ?? 0,
        totalAiTokens: aiTotals?.totalTokens ?? 0,
        estimatedAiCost:
          ((aiTotals?.estimatedCostMicros ?? 0) / 1_000_000) *
          conversion.rate,
        aiCostCurrency: "GBP",
        healthScore: computeDailyHealthScore(),
        schedulersEnabled: schedulers.filter((item) => item.enabled).length,
        schedulersRunning: schedulers.filter((item) => item.running).length,
      },
      geography: {
        countries:
          restaurants > 0
            ? [
                {
                  country: "United Kingdom",
                  restaurants,
                  completedClaims,
                },
              ]
            : [],
        cities,
      },
      notes: {
        claimConversionRate:
          "Claim visits are not currently tracked, so conversion rate is unavailable.",
        country:
          "Restaurant records do not yet store country; current imports are scoped to the United Kingdom.",
        aiCost:
          conversion.source === "environment"
            ? "Converted using the configured USD to GBP rate."
            : "Converted using the fallback USD to GBP estimate.",
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Global dashboard query failed");
    res.status(500).json({
      success: false,
      error: "Global dashboard data is unavailable.",
    });
  }
});

export default router;