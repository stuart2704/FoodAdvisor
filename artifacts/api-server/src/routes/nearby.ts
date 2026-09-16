import { Router, type IRouter } from "express";
import { ListNearbyRestaurantsQueryParams, ListNearbyRestaurantsResponse } from "@workspace/api-zod";
import { db, restaurantsTable } from "@workspace/db";
import { and, asc, isNotNull, sql } from "drizzle-orm";
import {
  MAX_NEARBY_RADIUS_MILES,
  MIN_NEARBY_RADIUS_MILES,
} from "../lib/geo";
import { toRestaurantResponse } from "../lib/restaurant-response";

const router: IRouter = Router();

router.get("/restaurants/nearby", async (req, res): Promise<void> => {
  const parsed = ListNearbyRestaurantsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { latitude, longitude, radiusMiles } = parsed.data;
  if (
    radiusMiles < MIN_NEARBY_RADIUS_MILES ||
    radiusMiles > MAX_NEARBY_RADIUS_MILES
  ) {
    res.status(400).json({
      error: `radiusMiles must be between ${MIN_NEARBY_RADIUS_MILES} and ${MAX_NEARBY_RADIUS_MILES}.`,
    });
    return;
  }

  // Keep the calculation in PostgreSQL so the response is sorted and capped
  // using only stored coordinates. No geocoding or provider request occurs.
  const distanceMiles = sql<number>`
    3958.7613 * acos(least(1, greatest(-1,
      sin(radians(${latitude})) * sin(radians(${restaurantsTable.latitude})) +
      cos(radians(${latitude})) * cos(radians(${restaurantsTable.latitude})) *
      cos(radians(${restaurantsTable.longitude}) - radians(${longitude}))
    )))
  `;
  const premiumAdjustedDistance = sql<number>`
    greatest(
      0,
      ${distanceMiles} -
      case when ${restaurantsTable.premium} then 1 else 0 end
    )
  `;

  const rows = await db
    .select({
      restaurant: restaurantsTable,
      distanceMiles,
    })
    .from(restaurantsTable)
    .where(
      and(
        isNotNull(restaurantsTable.latitude),
        isNotNull(restaurantsTable.longitude),
        sql`${distanceMiles} <= ${radiusMiles}`,
      ),
    )
    .orderBy(asc(premiumAdjustedDistance), asc(distanceMiles))
    .limit(100);

  const response = rows.map(({ restaurant, distanceMiles: distance }) =>
    toRestaurantResponse(restaurant, Number(distance)),
  );
  res.json(ListNearbyRestaurantsResponse.parse(response));
});

export default router;