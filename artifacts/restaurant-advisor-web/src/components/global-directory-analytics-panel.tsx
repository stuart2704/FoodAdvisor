import { useCallback, useEffect, useState } from "react";

interface GlobalMetrics {
  success: boolean;
  totalRestaurants: number;
  countries: number;
  cities: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  topCountries: Record<string, number>;
  topCities: Record<string, number>;
  lastUpdated: string | null;
}

interface DirectoryMetrics {
  success: boolean;
  periodDays: number;
  loads: number;
  loadsToday: number;
  deeperPageLoads: number;
  filteredLoads: number;
  premiumOnlyLoads: number;
  averageResults: number;
  generatedAt: string;
}

interface StatusCount {
  status: string;
  count: number;
}

interface CuisineMetrics {
  success: boolean;
  periodDays: number;
  views: number;
  viewsToday: number;
  topCuisines: Array<{ cuisine: string; views: number }>;
}

interface AnalyticsData {
  global: GlobalMetrics;
  directory: DirectoryMetrics;
  statuses: StatusCount[];
  cuisines: CuisineMetrics;
}

function isCountRecord(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
  );
}

function isAnalyticsData(value: AnalyticsData): boolean {
  return (
    value.global.success === true &&
    Number.isSafeInteger(value.global.totalRestaurants) &&
    value.global.totalRestaurants >= 0 &&
    Number.isSafeInteger(value.global.countries) &&
    value.global.countries >= 0 &&
    Number.isSafeInteger(value.global.cities) &&
    value.global.cities >= 0 &&
    isCountRecord(value.global.topCountries) &&
    isCountRecord(value.global.topCities) &&
    value.directory.success === true &&
    Number.isSafeInteger(value.directory.loads) &&
    value.directory.loads >= 0 &&
    Number.isSafeInteger(value.directory.loadsToday) &&
    value.directory.loadsToday >= 0 &&
    Array.isArray(value.statuses) &&
    value.statuses.every(
      (row) =>
        typeof row.status === "string" &&
        Number.isSafeInteger(row.count) &&
        row.count >= 0,
    ) &&
    value.cuisines.success === true &&
    Array.isArray(value.cuisines.topCuisines) &&
    value.cuisines.topCuisines.every(
      (row) =>
        typeof row.cuisine === "string" &&
        Number.isSafeInteger(row.views) &&
        row.views >= 0,
    )
  );
}

async function readJson<T>(response: Response, label: string): Promise<T> {
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `${label} returned ${response.status}`,
    );
  }
  return body;
}

function CountList({
  values,
  emptyMessage,
}: {
  values: Array<[string, number]>;
  emptyMessage: string;
}) {
  if (!values.length) return <p>{emptyMessage}</p>;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {values.map(([label, count]) => (
        <li
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            padding: "4px 0",
          }}
        >
          <span>{label.replaceAll("_", " ")}</span>
          <strong>{count.toLocaleString()}</strong>
        </li>
      ))}
    </ul>
  );
}

export default function GlobalDirectoryAnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const options: RequestInit = {
        credentials: "include",
        cache: "no-store",
        signal,
      };
      const [globalResponse, directoryResponse, statusResponse, cuisineResponse] =
        await Promise.all([
          fetch("/dashboard/global", options),
          fetch("/dashboard/directory-metrics", options),
          fetch("/dashboard/status", options),
          fetch("/dashboard/cuisine-metrics", options),
        ]);
      const data: AnalyticsData = {
        global: await readJson<GlobalMetrics>(globalResponse, "Global metrics"),
        directory: await readJson<DirectoryMetrics>(
          directoryResponse,
          "Directory metrics",
        ),
        statuses: await readJson<StatusCount[]>(statusResponse, "Status metrics"),
        cuisines: await readJson<CuisineMetrics>(
          cuisineResponse,
          "Cuisine metrics",
        ),
      };
      if (!isAnalyticsData(data)) {
        throw new Error("The backend returned an unexpected analytics response.");
      }
      setAnalytics(data);
    } catch (failure) {
      if (signal?.aborted) return;
      setAnalytics(null);
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

  if (loading && !analytics) {
    return <p aria-live="polite">Loading global directory analytics…</p>;
  }

  if (error) {
    return (
      <div role="alert" style={{ color: "#ff7b7b", marginTop: 30 }}>
        <p>Error: {error}</p>
        <button type="button" onClick={() => void loadData()}>
          Retry
        </button>
      </div>
    );
  }

  if (!analytics) return <p>No global directory analytics are available.</p>;

  const topCountries = Object.entries(analytics.global.topCountries).sort(
    ([, countA], [, countB]) => countB - countA,
  );
  const topCities = Object.entries(analytics.global.topCities).sort(
    ([, countA], [, countB]) => countB - countA,
  );

  return (
    <section
      aria-labelledby="global-directory-title"
      style={{
        marginTop: 30,
        border: "1px solid #303030",
        borderRadius: 10,
        padding: 18,
        background: "#171717",
      }}
    >
      <h2 id="global-directory-title" style={{ marginTop: 0 }}>
        Global Directory Analytics
      </h2>
      <p style={{ color: "#aaa" }}>
        Restaurant coverage plus directory activity from the last{" "}
        {analytics.directory.periodDays} days.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
        }}
      >
        {[
          ["Restaurants", analytics.global.totalRestaurants],
          ["Countries", analytics.global.countries],
          ["Cities", analytics.global.cities],
          ["New this week", analytics.global.newThisWeek],
          ["Directory loads", analytics.directory.loads],
          ["Loads today", analytics.directory.loadsToday],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{ borderRadius: 8, padding: 12, background: "#222" }}
          >
            <p style={{ color: "#aaa", margin: 0 }}>{label}</p>
            <strong style={{ display: "block", fontSize: 24, marginTop: 6 }}>
              {Number(value).toLocaleString()}
            </strong>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 20,
          marginTop: 20,
        }}
      >
        <div>
          <h3>By Country</h3>
          <CountList values={topCountries} emptyMessage="No country data." />
        </div>
        <div>
          <h3>Top Cities</h3>
          <CountList values={topCities} emptyMessage="No city data." />
        </div>
        <div>
          <h3>By Outreach Status</h3>
          <CountList
            values={analytics.statuses.map(({ status, count }) => [status, count])}
            emptyMessage="No status data."
          />
        </div>
        <div>
          <h3>Top Cuisine Page Views</h3>
          <CountList
            values={analytics.cuisines.topCuisines.map(({ cuisine, views }) => [
              cuisine,
              views,
            ])}
            emptyMessage="No cuisine page views recorded."
          />
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>Directory Usage</h3>
      <ul>
        <li>Filtered loads: {analytics.directory.filteredLoads.toLocaleString()}</li>
        <li>
          Deeper-page loads:{" "}
          {analytics.directory.deeperPageLoads.toLocaleString()}
        </li>
        <li>
          Premium-only loads:{" "}
          {analytics.directory.premiumOnlyLoads.toLocaleString()}
        </li>
        <li>Average results: {analytics.directory.averageResults}</li>
      </ul>
    </section>
  );
}