import { aiUsageEventsTable, db } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { getUsdToGbpRate } from "../services/aiUsage";

const router: IRouter = Router();

router.get("/ai-usage", adminOnly, async (req, res) => {
  try {
    const [[totals], models] = await Promise.all([
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
          lastUpdated: sql<Date | null>`max(${aiUsageEventsTable.createdAt})`,
        })
        .from(aiUsageEventsTable),
      db
        .select({
          model: aiUsageEventsTable.model,
          calls: sql<number>`count(*)`.mapWith(Number),
          totalTokens:
            sql<number>`coalesce(sum(${aiUsageEventsTable.totalTokens}), 0)`.mapWith(Number),
          estimatedCostMicros:
            sql<number>`coalesce(sum(${aiUsageEventsTable.estimatedCostMicros}), 0)`.mapWith(Number),
        })
        .from(aiUsageEventsTable)
        .groupBy(aiUsageEventsTable.model)
        .orderBy(desc(sql<number>`count(*)`)),
    ]);

    const conversion = getUsdToGbpRate();
    const modelBreakdown = Object.fromEntries(
      models.map((model) => [model.model, model.calls]),
    );
    const modelDetails = Object.fromEntries(
      models.map((model) => [
        model.model,
        {
          calls: model.calls,
          totalTokens: model.totalTokens,
          estimatedCost:
            (model.estimatedCostMicros / 1_000_000) * conversion.rate,
        },
      ]),
    );

    const lastUpdated = totals?.lastUpdated;
    res.json({
      success: true,
      dailyCalls: totals?.dailyCalls ?? 0,
      monthlyCalls: totals?.monthlyCalls ?? 0,
      totalTokens: totals?.totalTokens ?? 0,
      estimatedCost:
        ((totals?.estimatedCostMicros ?? 0) / 1_000_000) * conversion.rate,
      currency: "GBP",
      estimate: true,
      usdToGbpRate: conversion.rate,
      exchangeRateSource: conversion.source,
      modelBreakdown,
      modelDetails,
      lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Dashboard AI usage query failed");
    res.status(500).json({
      success: false,
      error: "AI usage is unavailable.",
    });
  }
});

export default router;