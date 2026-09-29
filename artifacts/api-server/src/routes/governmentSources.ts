import { GetGovernmentSourceReadinessResponse, PreviewGovernmentSourceBody, PreviewGovernmentSourceResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { fetchFsaBatch } from "../governmentSources/fsa";
import { fetchFranceBatch } from "../governmentSources/france";
import { fetchNycBatch } from "../governmentSources/nyc";
import { adminOnly } from "../middleware/adminOnly";
import { db, governmentImportDecisionsTable, governmentImportRunsTable, governmentImportSourcesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { billingGate, sourceIsPublishable } from "../governmentSources/importer";
import type { GovernmentSource } from "../governmentSources/types";

const router: IRouter = Router();
router.use(adminOnly);

const sources = [
  {
    code: "FSA_UK",
    label: "Food Standards Agency food hygiene data",
    region: "United Kingdom",
    licenceUrl: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    datasetUrl: "https://ratings.food.gov.uk/open-data",
  },
  {
    code: "ALIM_FR",
    label: "Alim’confiance food inspections",
    region: "France",
    licenceUrl: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    datasetUrl: "https://www.data.gouv.fr/datasets/resultats-des-controles-officiels-sanitaires-dispositif-dinformation-alimconfiance/",
  },
  {
    code: "NYC_DOHMH",
    label: "NYC restaurant inspections",
    region: "New York City, United States",
    licenceUrl: "https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje",
    datasetUrl: "https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j",
  },
] as const;

router.get("/operations/government-sources", async (req, res): Promise<void> => {
  try {
  const [states, runs, decisions, gate] = await Promise.all([
    db.select().from(governmentImportSourcesTable),
    db.select().from(governmentImportRunsTable).orderBy(desc(governmentImportRunsTable.startedAt)).limit(15),
    db.select().from(governmentImportDecisionsTable).orderBy(desc(governmentImportDecisionsTable.createdAt)).limit(15),
    billingGate(),
  ]);
  res.json(GetGovernmentSourceReadinessResponse.parse({
    success: true,
    phase: "baseline",
    publishingEnabled: false,
    plannedDailyRunUtc: "02:30 UTC (not active)",
    initialDailyLimitPerSource: 100,
    additionalMonthlyBudgetGbp: 10,
    pauseAtAdditionalGbp: 7,
    costMeterConnected: false,
    sources: sources.map((source) => ({
      ...source,
      approved: states.find((s) => s.source === source.code)?.approved ?? false,
      paused: states.find((s) => s.source === source.code)?.paused ?? true,
      publishable: sourceIsPublishable(source.code),
    })),
    billingBlocker: gate.reason,
    recentRuns: runs.map((run) => ({
      source: run.source, runDay: run.runDay, status: run.status,
      scanned: run.scanned, inserted: run.inserted, updated: run.updated, skipped: run.skipped,
      error: run.error,
    })),
    recentDecisions: decisions.map((decision) => ({
      source: decision.source, action: decision.action, createdAt: decision.createdAt.toISOString(),
    })),
  }));
  } catch (error) {
    req.log.error({ err: error }, "Government source readiness unavailable");
    res.status(503).json({ success: false, error: "Import state is unavailable." });
  }
});

const sourceDecision = z.object({
  source: z.enum(["FSA_UK", "ALIM_FR", "NYC_DOHMH"]),
  action: z.enum(["approve", "pause", "resume"]),
}).strict();

router.post("/operations/government-sources/control", async (req, res): Promise<void> => {
  const parsed = sourceDecision.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid source or action." });
    return;
  }
  const { source, action } = parsed.data;
  if (!sourceIsPublishable(source)) {
    res.status(409).json({ success: false, error: "NYC inspection history is not approved for publication." });
    return;
  }
  if (action === "resume") {
    const gate = await billingGate();
    if (!gate.ready) {
      res.status(409).json({ success: false, error: gate.reason });
      return;
    }
  }
  try {
    const [current] = await db.select().from(governmentImportSourcesTable)
      .where(eq(governmentImportSourcesTable.source, source));
    if (action === "resume" && !current?.approved) {
      res.status(409).json({ success: false, error: "Review and approve this source first." });
      return;
    }
    await db.transaction(async (tx) => {
    await tx.insert(governmentImportSourcesTable).values({
      source, approved: action === "approve" ? true : current?.approved ?? false,
      paused: action === "resume" ? false : true,
      reviewedAt: action === "approve" ? new Date() : current?.reviewedAt ?? null,
    }).onConflictDoUpdate({
      target: governmentImportSourcesTable.source,
      set: {
        approved: action === "approve" ? true : current?.approved ?? false,
        paused: action !== "resume",
        reviewedAt: action === "approve" ? new Date() : current?.reviewedAt ?? null,
        updatedAt: new Date(),
      },
    });
    await tx.insert(governmentImportDecisionsTable).values({ source, action });
    });
    req.log.info({ source, action }, "Government source control changed");
    res.json({ success: true, source, action });
  } catch (error) {
    req.log.error({ err: error, source, action }, "Government source control failed");
    res.status(503).json({ success: false, error: "Import control is unavailable." });
  }
});
router.post(
  "/operations/government-sources/preview",
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 9,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { success: false, error: "Too many source previews. Try again later." },
  }),
  async (req, res) => {
    const input = PreviewGovernmentSourceBody.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ success: false, error: "Select a supported source and a page size from 1 to 50." });
      return;
    }

    const { source, limit } = input.data;
    try {
      const page = source === "FSA_UK"
        ? await fetchFsaBatch(null, limit)
        : source === "ALIM_FR"
          ? await fetchFranceBatch(null, limit)
          : await fetchNycBatch(null, limit);
      res.json(PreviewGovernmentSourceResponse.parse({
        success: true,
        source,
        checkedAt: new Date().toISOString(),
        scanned: page.scanned,
        eligible: page.listings.length,
        skipped: page.scanned - page.listings.length,
        nextCursor: page.nextCursor,
        listings: page.listings.map((item) => ({
          sourceId: item.sourceId,
          name: item.name,
          address: item.address,
          city: item.city,
          country: item.country,
          coordinatesAvailable: item.latitude !== null && item.longitude !== null,
        })),
      }));
    } catch (error) {
      req.log.error({ err: error, source }, "Government source dry-run failed");
      res.status(503).json({ success: false, error: "The selected public-data source is unavailable or returned invalid data." });
    }
  },
);

export default router;