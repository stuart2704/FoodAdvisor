import { Router, type IRouter } from "express";
import { adminOnly } from "../middleware/adminOnly";
import { globalCities } from "../external/cityList";
import { regionForCountry } from "../external/regions";
import { orchestrateIngestion } from "../external/ingestionOrchestrator";
import { runIngestionForCity } from "../ingestion/runIngestion";
import type { Region } from "../external/globalRouter";
import { EXTERNAL_INGESTION_INTERVAL_MS } from "../cron/scheduler";

const router: IRouter = Router();
const allowedCities = new Set(["cardiff", "london"]);

function parseRegion(value: unknown): Region | null {
  return value === "eu" || value === "us" || value === "apac" ? value : null;
}

router.post("/", adminOnly, async (req, res) => {
  const region = parseRegion(req.query.region);
  const cityName = req.query.city;
  if (!region || typeof cityName !== "string" || !cityName.trim()) {
    res.status(400).json({ error: "A valid region and city are required." });
    return;
  }
  const normalizedCity = cityName.trim().toLowerCase();
  if (!allowedCities.has(normalizedCity)) {
    res.status(403).json({
      error: "Manual ingestion is not allowed for this city.",
      allowed: [...allowedCities],
    });
    return;
  }
  const city = globalCities.find(
    (entry) => entry.name.toLowerCase() === normalizedCity,
  );
  if (!city) {
    res.status(400).json({ error: "This city is not configured for OSM ingestion." });
    return;
  }
  if (regionForCountry(city.country) !== region) {
    res.status(400).json({ error: "The city does not belong to the requested region." });
    return;
  }

  try {
    const routing = await orchestrateIngestion(region);
    req.log.info(
      { city: city.name, requestedRegion: region, actualRegion: "local", routing },
      "Manual city ingestion started; routing is advisory only",
    );

    const result = await runIngestionForCity(city, new Date());
    if (result.status === "busy") {
      res.status(409).json({ error: "Another ingestion run is already in progress." });
      return;
    }
    if (result.status === "source_suppressed") {
      res.status(409).json({ error: "OSM ingestion is currently suppressed." });
      return;
    }
    if (result.status === "cooldown") {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      const lastRun = Date.parse(result.lastRunAt);
      res.status(409).json({
        error: "Manual ingestion of this city is limited to one successful run every 12 hours.",
        lastRun,
        nextAllowed: lastRun + EXTERNAL_INGESTION_INTERVAL_MS,
        lastRunAt: result.lastRunAt,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }
    req.log.info(
      { city: city.name, requestedRegion: region, actualRegion: "local", candidatesFetched: result.candidatesFetched },
      "Manual city ingestion completed",
    );
    res.json({
      requestedRegion: region,
      ingestRegion: "local",
      execution: "local",
      routing,
      result,
    });
  } catch (error) {
    req.log.error({ err: error, region, city: city.name }, "Manual city ingestion failed");
    res.status(503).json({ error: "Manual ingestion failed; this city's 12-hour window was not advanced." });
  }
});

export default router;