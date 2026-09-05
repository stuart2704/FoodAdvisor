import { Router, type IRouter } from "express";
import {
  CreateRestaurantImportPlanBody,
  CreateRestaurantImportPlanResponse,
  GetRestaurantImportStatusResponse,
  RunRestaurantImportBody,
  RunRestaurantImportResponse,
  ListRestaurantsQueryParams,
  ListRestaurantsResponse,
} from "@workspace/api-zod";
import { db, restaurantsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  createImportPlan,
  getImportStatus,
  runImport,
} from "../lib/restaurant-import";

const router: IRouter = Router();

router.get("/restaurant-import/status", async (req, res): Promise<void> => {
  const status = await getImportStatus();
  res.json(GetRestaurantImportStatusResponse.parse(status));
});

router.post("/restaurant-import/plan", async (req, res): Promise<void> => {
  const parsed = CreateRestaurantImportPlanBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid import plan");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const plan = await createImportPlan(parsed.data);
  res.json(CreateRestaurantImportPlanResponse.parse(plan));
});

router.post("/restaurant-import/run", async (req, res): Promise<void> => {
  const parsed = RunRestaurantImportBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid import request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await runImport(parsed.data);
    res.json(RunRestaurantImportResponse.parse(result));
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "GooglePlacesNotConfigured"
    ) {
      res.status(503).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message.includes("confirmation")) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.get("/restaurants", async (req, res): Promise<void> => {
  const parsed = ListRestaurantsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db
    .select()
    .from(restaurantsTable)
    .where(
      parsed.data.city
        ? eq(restaurantsTable.city, parsed.data.city)
        : undefined,
    )
    .orderBy(desc(restaurantsTable.importedAt))
    .limit(100);

  res.json(
    ListRestaurantsResponse.parse(
      rows.map((row) => ({
        id: row.placeId,
        name: row.name,
        address: row.address,
        city: row.city,
        rating: row.rating,
        website: row.website,
        googleMapsUrl: row.googleMapsUrl,
        types: row.types,
      })),
    ),
  );
});

export default router;