import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RestaurantImportPlan,
  RestaurantImportRunResult,
  RestaurantImportStatus,
} from "@workspace/api-client-react";

interface AdminRestaurant {
  placeId: string;
  name: string;
  city: string;
  outreachStatus: string;
}

interface AdminRestaurantsResponse {
  success: boolean;
  restaurants: AdminRestaurant[];
  error?: string;
}

function formatPence(value: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value / 100);
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export default function RestaurantIngestionPanel() {
  const [status, setStatus] = useState<RestaurantImportStatus | null>(null);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [citiesText, setCitiesText] = useState("");
  const [perCityLimit, setPerCityLimit] = useState(10);
  const [monthlyBudgetPounds, setMonthlyBudgetPounds] = useState("25");
  const [plan, setPlan] = useState<RestaurantImportPlan | null>(null);
  const [plannedInputKey, setPlannedInputKey] = useState<string | null>(null);
  const [result, setResult] = useState<RestaurantImportRunResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"plan" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const cities = useMemo(
    () =>
      [...new Set(citiesText.split(",").map((city) => city.trim()).filter(Boolean))],
    [citiesText],
  );
  const monthlyBudgetCents = Math.round(Number(monthlyBudgetPounds) * 100);
  const inputKey = JSON.stringify({ cities, perCityLimit, monthlyBudgetCents });

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [statusResponse, restaurantsResponse] = await Promise.all([
        fetch("/dashboard/restaurant-import/status", {
          credentials: "include",
          cache: "no-store",
          signal,
        }),
        fetch("/dashboard/restaurants?page=1&limit=10", {
          credentials: "include",
          cache: "no-store",
          signal,
        }),
      ]);
      if (!statusResponse.ok) {
        throw new Error(
          await readError(statusResponse, `Status failed (${statusResponse.status})`),
        );
      }
      if (!restaurantsResponse.ok) {
        throw new Error(
          await readError(
            restaurantsResponse,
            `Restaurants failed (${restaurantsResponse.status})`,
          ),
        );
      }
      const statusData = (await statusResponse.json()) as RestaurantImportStatus;
      const restaurantsData =
        (await restaurantsResponse.json()) as AdminRestaurantsResponse;
      if (!restaurantsData.success || !Array.isArray(restaurantsData.restaurants)) {
        throw new Error(restaurantsData.error ?? "Restaurants could not be loaded.");
      }
      setStatus(statusData);
      setRestaurants(restaurantsData.restaurants);
      setCitiesText((current) =>
        current || !statusData.cities.length
          ? current
          : statusData.cities.join(", "),
      );
    } catch (failure) {
      if (signal?.aborted) return;
      setError(
        failure instanceof Error ? failure.message : "Network or server error",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  function validateInput() {
    if (cities.length < 1 || cities.length > 7) {
      return "Enter between 1 and 7 comma-separated cities.";
    }
    if (cities.some((city) => city.length < 2)) {
      return "Each city must contain at least 2 characters.";
    }
    if (!Number.isInteger(perCityLimit) || perCityLimit < 1 || perCityLimit > 20) {
      return "Per-city limit must be a whole number from 1 to 20.";
    }
    if (!Number.isSafeInteger(monthlyBudgetCents) || monthlyBudgetCents < 1) {
      return "Enter a valid monthly budget.";
    }
    return null;
  }

  async function planImport() {
    const validationError = validateInput();
    if (validationError) {
      setActionError(validationError);
      return;
    }
    setAction("plan");
    setActionError(null);
    setResult(null);
    setConfirmed(false);
    try {
      const response = await fetch("/dashboard/restaurant-import/plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities, perCityLimit, monthlyBudgetCents }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, `Plan failed (${response.status})`));
      }
      setPlan((await response.json()) as RestaurantImportPlan);
      setPlannedInputKey(inputKey);
    } catch (failure) {
      setPlan(null);
      setPlannedInputKey(null);
      setActionError(
        failure instanceof Error ? failure.message : "Network or server error",
      );
    } finally {
      setAction(null);
    }
  }

  async function runImport() {
    if (!plan || plannedInputKey !== inputKey || !plan.withinBudget || !confirmed) {
      setActionError("Create the current plan and confirm its estimated cost first.");
      return;
    }
    setAction("run");
    setActionError(null);
    try {
      const response = await fetch("/dashboard/restaurant-import/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cities,
          perCityLimit,
          monthlyBudgetCents,
          confirm: true,
        }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, `Import failed (${response.status})`));
      }
      setResult((await response.json()) as RestaurantImportRunResult);
      setConfirmed(false);
      setPlan(null);
      setPlannedInputKey(null);
      await loadData();
    } catch (failure) {
      setActionError(
        failure instanceof Error ? failure.message : "Network or server error",
      );
    } finally {
      setAction(null);
    }
  }

  if (loading && !status) {
    return <p aria-live="polite">Loading ingestion data…</p>;
  }

  if (error && !status) {
    return (
      <div role="alert" style={{ color: "#ff7b7b", marginTop: 30 }}>
        <p>Error: {error}</p>
        <button type="button" onClick={() => void loadData()}>
          Retry
        </button>
      </div>
    );
  }

  if (!status) return <p>No ingestion data is available.</p>;

  const currentPlan = plannedInputKey === inputKey ? plan : null;

  return (
    <section
      aria-labelledby="restaurant-ingestion-title"
      style={{
        marginTop: 30,
        border: "1px solid #303030",
        borderRadius: 10,
        padding: 18,
        background: "#171717",
      }}
    >
      <h2 id="restaurant-ingestion-title" style={{ marginTop: 0 }}>
        Restaurant Ingestion
      </h2>
      <p style={{ color: "#aaa" }}>
        Preview the expected Google Places cost before running a confirmed import.
      </p>

      <ul>
        <li>Monthly budget: {formatPence(status.monthlyBudgetCents)}</li>
        <li>Spent: {formatPence(status.spentCents)}</li>
        <li>Remaining: {formatPence(status.remainingCents)}</li>
        <li>API calls used: {status.callsUsed.toLocaleString()}</li>
        <li>Restaurants imported: {status.restaurantsImported.toLocaleString()}</li>
        <li>
          Last run:{" "}
          {status.lastRunAt ? new Date(status.lastRunAt).toLocaleString() : "None"}
        </li>
      </ul>

      <div style={{ display: "grid", gap: 12, maxWidth: 620 }}>
        <label>
          Cities, separated by commas
          <input
            value={citiesText}
            onChange={(event) => setCitiesText(event.target.value)}
            placeholder="London, Manchester"
            disabled={action !== null}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label>
          Restaurants per city
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={perCityLimit}
            onChange={(event) => setPerCityLimit(Number(event.target.value))}
            disabled={action !== null}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label>
          Monthly budget (£)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={monthlyBudgetPounds}
            onChange={(event) => setMonthlyBudgetPounds(event.target.value)}
            disabled={action !== null}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <button
          type="button"
          onClick={() => void planImport()}
          disabled={action !== null}
        >
          {action === "plan" ? "Planning…" : "Preview Import Plan"}
        </button>
      </div>

      {actionError ? (
        <p role="alert" style={{ color: "#ff7b7b" }}>
          {actionError}
        </p>
      ) : null}

      {currentPlan ? (
        <div style={{ marginTop: 20 }}>
          <h3>Plan Preview</h3>
          <ul>
            <li>Restaurants requested: {currentPlan.totalRestaurants}</li>
            <li>Estimated API calls: {currentPlan.totalApiCalls}</li>
            <li>Estimated cost: {formatPence(currentPlan.estimatedCostCents)}</li>
            <li>Within budget: {currentPlan.withinBudget ? "Yes" : "No"}</li>
          </ul>
          <p>{currentPlan.note}</p>
          <label style={{ display: "block", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              disabled={!currentPlan.withinBudget || action !== null}
            />{" "}
            I confirm this import may use paid Google Places API calls up to the
            displayed monthly budget.
          </label>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={!currentPlan.withinBudget || !confirmed || action !== null}
          >
            {action === "run" ? "Running Import…" : "Run Confirmed Import"}
          </button>
        </div>
      ) : null}

      {result ? (
        <div role="status" style={{ marginTop: 20 }}>
          <h3>Latest Import Result</h3>
          <p>
            Imported {result.imported}; skipped {result.skippedDuplicates}{" "}
            duplicates; used {result.apiCalls} API calls; charged{" "}
            {formatPence(result.chargedCents)}. {result.stoppedBecause}
          </p>
        </div>
      ) : null}

      <h3 style={{ marginTop: 24 }}>Recently Ingested Restaurants</h3>
      {restaurants.length === 0 ? (
        <p>No restaurants found.</p>
      ) : (
        <ul>
          {restaurants.map((restaurant) => (
            <li key={restaurant.placeId}>
              {restaurant.name} — {restaurant.city} (
              {restaurant.outreachStatus.replaceAll("_", " ")})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}