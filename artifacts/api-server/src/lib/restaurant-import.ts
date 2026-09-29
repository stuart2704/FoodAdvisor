import { count, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  restaurantImportRunsTable,
  restaurantsTable,
} from "@workspace/db";
import { getRegionForCity } from "../services/regionMap";
import { restaurantSlug } from "../utils/slugify";
import { normaliseCoordinates, type Coordinates } from "./geo";
import {
  ESTIMATED_GRID_REQUEST_COST_CENTS, MONTHLY_PAID_BUDGET_GBP, MONTHLY_PAID_LIMIT,
} from "./gridCrawlPlan";
import { getGridRuntimeState, reservePaidSearchTextCall } from "./gridCrawlRuntime";
import {
  recordBusinessEmailResearchFailure,
  runBusinessEmailResearch,
} from "../services/enrichment/businessEmailResearch";
import { logger } from "./logger";
import { countBusinessEmailResearchOutcome } from "../services/enrichment/businessEmailResearchRules";

export const SUPPORTED_CITIES = [
  "London",
  "Cardiff",
  "Edinburgh",
  "Glasgow",
  "Manchester",
  "Liverpool",
  "Belfast",
] as const;

const DEFAULT_SEARCH_COST_CENTS = 5;
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.location",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
].join(",");

type PlanInput = {
  cities: string[];
  perCityLimit?: number;
  monthlyBudgetCents: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  websiteUri?: string;
  googleMapsUri?: string;
  types?: string[];
};

export type ImportedRestaurant = {
  id: string;
  name: string;
  address: string;
  city: string;
  rating: number | null;
  website: string | null;
  googleMapsUrl: string;
  types: string[];
  location: Coordinates | null;
  outreachStatus: string;
  claimed: boolean;
};

function costPerSearchCents(): number {
  const configured = Number(process.env.GOOGLE_PLACES_SEARCH_COST_CENTS);
  return Math.max(
    ESTIMATED_GRID_REQUEST_COST_CENTS,
    Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_SEARCH_COST_CENTS,
  );
}

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function normaliseCities(cities: string[]): string[] {
  const supported = new Map(
    SUPPORTED_CITIES.map((city) => [city.toLowerCase(), city]),
  );
  return Array.from(
    new Set(
      cities
        .map((city) => supported.get(city.trim().toLowerCase()))
        .filter((city): city is (typeof SUPPORTED_CITIES)[number] => !!city),
    ),
  );
}

async function currentMonthSpend(): Promise<{
  spentCents: number;
  callsUsed: number;
}> {
  const [row] = await db
    .select({
      spentCents: sql<number>`coalesce(sum(${restaurantImportRunsTable.estimatedCostCents}), 0)`,
      callsUsed: sql<number>`coalesce(sum(${restaurantImportRunsTable.apiCalls}), 0)`,
    })
    .from(restaurantImportRunsTable)
    .where(gte(restaurantImportRunsTable.createdAt, monthStart()));

  return {
    spentCents: Math.max(Number(row?.spentCents ?? 0),
      Number(row?.callsUsed ?? 0) * ESTIMATED_GRID_REQUEST_COST_CENTS),
    callsUsed: Number(row?.callsUsed ?? 0),
  };
}

export async function getImportStatus() {
  const [spend, [restaurantCount], [latestRun], cityRows, crawlState] = await Promise.all([
    currentMonthSpend(),
    db.select({ value: count() }).from(restaurantsTable),
    db
      .select()
      .from(restaurantImportRunsTable)
      .orderBy(sql`${restaurantImportRunsTable.createdAt} desc`)
      .limit(1),
    db
      .selectDistinct({ city: restaurantsTable.city })
      .from(restaurantsTable)
      .orderBy(restaurantsTable.city),
    getGridRuntimeState(),
  ]);

  const monthlyBudgetCents = crawlState.monthly_budget_cents;

  return {
    monthlyBudgetCents: Math.min(monthlyBudgetCents, MONTHLY_PAID_BUDGET_GBP * 100),
    spentCents: spend.spentCents,
    remainingCents: Math.max(0, Math.min(monthlyBudgetCents, MONTHLY_PAID_BUDGET_GBP * 100) - spend.spentCents),
    callsUsed: spend.callsUsed,
    restaurantsImported: Number(restaurantCount?.value ?? 0),
    lastRunAt: latestRun?.createdAt.toISOString() ?? null,
    cities: cityRows.map((row) => row.city),
  };
}

export async function createImportPlan(input: PlanInput) {
  const cities = normaliseCities(input.cities);
  const perCityLimit = Math.min(20, Math.max(1, input.perCityLimit ?? 10));
  const { spentCents, callsUsed } = await currentMonthSpend();
  const monthlyBudgetCents = Math.min(input.monthlyBudgetCents, MONTHLY_PAID_BUDGET_GBP * 100);
  let remaining = Math.max(0, monthlyBudgetCents - spentCents);
  let remainingCalls = Math.max(0, MONTHLY_PAID_LIMIT - callsUsed);
  const unitCost = costPerSearchCents();

  const cityPlans = cities.map((city) => {
    const ready = remaining >= unitCost && remainingCalls > 0;
    if (ready) {
      remaining -= unitCost;
      remainingCalls -= 1;
    }
    return {
      city,
      requested: ready ? perCityLimit : 0,
      estimatedApiCalls: ready ? 1 : 0,
      estimatedCostCents: ready ? unitCost : 0,
      status: ready ? ("ready" as const) : ("skipped" as const),
    };
  });

  const estimatedCostCents = cityPlans.reduce(
    (total, city) => total + city.estimatedCostCents,
    0,
  );
  const totalApiCalls = cityPlans.reduce(
    (total, city) => total + city.estimatedApiCalls,
    0,
  );

  return {
    cities: cityPlans,
    totalRestaurants: cityPlans.reduce(
      (total, city) => total + city.requested,
      0,
    ),
    totalApiCalls,
    estimatedCostCents,
    monthlyBudgetCents,
    withinBudget: cityPlans.every((city) => city.status === "ready"),
    note:
      cityPlans.every((city) => city.status === "ready")
        ? `Estimated guard uses ${unitCost}p per search request and a narrow field mask.`
        : "Some cities were skipped because the monthly safety cap would be exceeded.",
  };
}

async function searchRestaurants(
  city: string,
  limit: number,
  apiKey: string,
): Promise<ImportedRestaurant[]> {
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: `restaurants in ${city}, United Kingdom`,
        includedType: "restaurant",
        strictTypeFiltering: true,
        maxResultCount: limit,
        languageCode: "en",
        regionCode: "GB",
      }),
    },
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google Places request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as { places?: GooglePlace[] };
  return (payload.places ?? [])
    .filter(
      (place): place is GooglePlace & { id: string } =>
        typeof place.id === "string" && place.id.length > 0,
    )
    .map((place) => ({
      id: place.id,
      name: place.displayName?.text ?? "Unnamed restaurant",
      address: place.formattedAddress ?? city,
      city,
      rating: typeof place.rating === "number" ? place.rating : null,
      location: normaliseCoordinates(place.location),
      website: place.websiteUri ?? null,
      googleMapsUrl:
        place.googleMapsUri ??
        `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}`,
      types: place.types ?? ["restaurant"],
      outreachStatus: "pending",
      claimed: false,
    }));
}

export async function runImport(input: PlanInput & { confirm: boolean }) {
  if (!input.confirm) {
    throw new Error("Import confirmation is required.");
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    const error = new Error(
      "Google Places is connected for development help, but live place search needs GOOGLE_MAPS_API_KEY in Replit Secrets.",
    );
    error.name = "GooglePlacesNotConfigured";
    throw error;
  }

  const plan = await createImportPlan(input);
  const runnableCities = plan.cities.filter((city) => city.status === "ready");
  const allRestaurants: ImportedRestaurant[] = [];
  let apiCalls = 0;
  let imported = 0;
  let skippedDuplicates = 0;
  let budgetStopped = false;
  const emailResearch = { succeeded: 0, failed: 0, skipped: 0 };

  for (const cityPlan of runnableCities) {
    // The plan is only an estimate: another importer or the grid crawler may
    // have reserved the remaining budget since it was created. The reservation
    // is committed before contacting Google and is the only gate for this call.
    const reservationId = await reservePaidSearchTextCall({
      city: cityPlan.city,
      requested: cityPlan.requested,
      costCents: costPerSearchCents(),
      monthlyBudgetCents: input.monthlyBudgetCents,
    });
    if (reservationId === null) {
      budgetStopped = true;
      break;
    }

    const places = await searchRestaurants(
      cityPlan.city,
      cityPlan.requested,
      apiKey,
    );
    apiCalls += 1;

    const existing = places.length
      ? await db
          .select({ placeId: restaurantsTable.placeId })
          .from(restaurantsTable)
          .where(inArray(restaurantsTable.placeId, places.map((place) => place.id)))
      : [];
    const existingIds = new Set(existing.map((row) => row.placeId));
    const fresh = places.filter((place) => !existingIds.has(place.id));

    if (fresh.length) {
      await db.insert(restaurantsTable).values(
        fresh.map((place) => ({
          placeId: place.id,
          name: place.name,
          address: place.address,
          city: place.city,
          ...(getRegionForCity(place.city) ?? {}),
          slug: restaurantSlug(place.name, place.id),
          rating: place.rating,
          latitude: place.location?.latitude ?? null,
          longitude: place.location?.longitude ?? null,
          website: place.website,
          googleMapsUrl: place.googleMapsUrl,
          types: place.types,
        })),
      );
      // Only newly inserted records receive this website-only check. Repeated
      // paid imports never re-enrich existing restaurants or alter their
      // outreach history.
      for (const restaurant of fresh) {
        try {
          const result = await runBusinessEmailResearch(restaurant.id);
          countBusinessEmailResearchOutcome(emailResearch, result.enrichment);
        } catch (error) {
          // Do not let an individual website check turn a paid, persisted
          // Places result into an ambiguous import retry.
          await recordBusinessEmailResearchFailure(restaurant.id, error);
          emailResearch.failed += 1;
          logger.error(
            { err: error, placeId: restaurant.id },
            "Restaurant email research failed after paid import",
          );
        }
      }
    }

    // A repeated place is still useful when Places has supplied a newly
    // verified location. Refresh only the nullable coordinates so this
    // explicitly approved import cannot overwrite outreach or claim state.
    for (const place of places) {
      if (!existingIds.has(place.id) || !place.location) continue;
      await db
        .update(restaurantsTable)
        .set({
          latitude: place.location.latitude,
          longitude: place.location.longitude,
        })
        .where(sql`${restaurantsTable.placeId} = ${place.id}`);
    }

    // A reservation is deliberately left untouched if fetching or persistence
    // throws. Only a fully completed city gets its ledger result fields.
    await db
      .update(restaurantImportRunsTable)
      .set({
        imported: fresh.length,
        skippedDuplicates: places.length - fresh.length,
        stoppedBecause: "Completed within the monthly budget safety cap.",
      })
      .where(sql`${restaurantImportRunsTable.id} = ${reservationId}`);

    allRestaurants.push(...places);
    imported += fresh.length;
    skippedDuplicates += places.length - fresh.length;
  }

  const chargedCents = apiCalls * costPerSearchCents();
  const stoppedBecause =
    budgetStopped || runnableCities.length < plan.cities.length
      ? "Monthly budget safety cap reached."
      : "Completed within the monthly budget safety cap.";

  return {
    imported,
    skippedDuplicates,
    apiCalls,
    chargedCents,
    stoppedBecause,
    restaurants: allRestaurants,
    emailResearch,
  };
}