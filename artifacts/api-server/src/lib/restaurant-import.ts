import { count, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  restaurantImportRunsTable,
  restaurantsTable,
} from "@workspace/db";

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
};

function costPerSearchCents(): number {
  const configured = Number(process.env.GOOGLE_PLACES_SEARCH_COST_CENTS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_SEARCH_COST_CENTS;
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
    spentCents: Number(row?.spentCents ?? 0),
    callsUsed: Number(row?.callsUsed ?? 0),
  };
}

export async function getImportStatus() {
  const [spend, [restaurantCount], [latestRun], cityRows] = await Promise.all([
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
  ]);

  const monthlyBudgetCents = Number(
    latestRun?.monthlyBudgetCents ?? process.env.GOOGLE_MONTHLY_BUDGET_CENTS ?? 2500,
  );

  return {
    monthlyBudgetCents,
    spentCents: spend.spentCents,
    remainingCents: Math.max(0, monthlyBudgetCents - spend.spentCents),
    callsUsed: spend.callsUsed,
    restaurantsImported: Number(restaurantCount?.value ?? 0),
    lastRunAt: latestRun?.createdAt.toISOString() ?? null,
    cities: cityRows.map((row) => row.city),
  };
}

export async function createImportPlan(input: PlanInput) {
  const cities = normaliseCities(input.cities);
  const perCityLimit = Math.min(20, Math.max(1, input.perCityLimit ?? 10));
  const { spentCents } = await currentMonthSpend();
  let remaining = Math.max(0, input.monthlyBudgetCents - spentCents);
  const unitCost = costPerSearchCents();

  const cityPlans = cities.map((city) => {
    const ready = remaining >= unitCost;
    if (ready) remaining -= unitCost;
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
    monthlyBudgetCents: input.monthlyBudgetCents,
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
      website: place.websiteUri ?? null,
      googleMapsUrl:
        place.googleMapsUri ??
        `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(place.id)}`,
      types: place.types ?? ["restaurant"],
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

  for (const cityPlan of runnableCities) {
    const places = await searchRestaurants(
      cityPlan.city,
      cityPlan.requested,
      apiKey,
    );
    apiCalls += 1;
    allRestaurants.push(...places);

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
          rating: place.rating,
          website: place.website,
          googleMapsUrl: place.googleMapsUrl,
          types: place.types,
        })),
      );
    }

    imported += fresh.length;
    skippedDuplicates += places.length - fresh.length;
  }

  const chargedCents = apiCalls * costPerSearchCents();
  const stoppedBecause =
    runnableCities.length < plan.cities.length
      ? "Monthly budget safety cap reached."
      : "Completed within the monthly budget safety cap.";

  await db.insert(restaurantImportRunsTable).values({
    cities: runnableCities.map((city) => city.city),
    requested: runnableCities.reduce((total, city) => total + city.requested, 0),
    imported,
    skippedDuplicates,
    apiCalls,
    estimatedCostCents: chargedCents,
    monthlyBudgetCents: input.monthlyBudgetCents,
    stoppedBecause,
  });

  return {
    imported,
    skippedDuplicates,
    apiCalls,
    chargedCents,
    stoppedBecause,
    restaurants: allRestaurants,
  };
}