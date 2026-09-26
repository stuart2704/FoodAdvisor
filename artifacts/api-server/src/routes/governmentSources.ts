import { GetGovernmentSourceReadinessResponse, PreviewGovernmentSourceBody, PreviewGovernmentSourceResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { fetchFsaBatch } from "../governmentSources/fsa";
import { fetchFranceBatch } from "../governmentSources/france";
import { fetchNycBatch } from "../governmentSources/nyc";
import { adminOnly } from "../middleware/adminOnly";

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

router.get("/operations/government-sources", (_req, res) => {
  res.json(GetGovernmentSourceReadinessResponse.parse({
    success: true,
    phase: "baseline",
    publishingEnabled: false,
    plannedDailyRunUtc: "02:30 UTC (not active)",
    initialDailyLimitPerSource: 100,
    additionalMonthlyBudgetGbp: 10,
    pauseAtAdditionalGbp: 7,
    costMeterConnected: false,
    sources,
  }));
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