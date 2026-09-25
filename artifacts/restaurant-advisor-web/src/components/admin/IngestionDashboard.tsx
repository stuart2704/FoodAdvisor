import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type IngestionHealth = {
  suppressedSources: string[];
  metrics: {
    totalCandidates: number;
    promoted: number;
    restaurants: number;
    eligible: number | null;
  };
};

function isHealth(value: unknown): value is IngestionHealth {
  if (!value || typeof value !== "object") return false;
  const health = value as Partial<IngestionHealth>;
  const metrics = health.metrics;
  return Array.isArray(health.suppressedSources) &&
    health.suppressedSources.every((name) => typeof name === "string") &&
    !!metrics &&
    typeof metrics.totalCandidates === "number" &&
    typeof metrics.promoted === "number" &&
    typeof metrics.restaurants === "number" &&
    (metrics.eligible === null || typeof metrics.eligible === "number");
}

export default function IngestionDashboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const navigate = useNavigate();
  const [health, setHealth] = useState<IngestionHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch("/api/admin/ingestion/health", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          navigate("/admin/login", { replace: true });
          throw new Error("Admin session expired.");
        }
        if (!response.ok) throw new Error("Ingestion health is unavailable.");
        const data: unknown = await response.json();
        if (!isHealth(data)) throw new Error("Ingestion health returned an unexpected response.");
        return data;
      })
      .then(setHealth)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setHealth(null);
        setError(failure instanceof Error ? failure.message : "Ingestion health is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [navigate, revision, refreshKey]);

  return (
    <section aria-labelledby="ingestion-title">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ color: "#ff8b47", fontWeight: 700, margin: 0 }}>The Food Advisor Admin</p>
          <h1 id="ingestion-title" style={{ margin: "6px 0 0" }}>The Food Advisor — Global Ingestion</h1>
        </div>
        <button
          type="button"
          data-testid="button-refresh-ingestion"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading}
          style={{ padding: "9px 14px", border: "1px solid #555", borderRadius: 8, background: "#252525", color: "#fff", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>
      <p style={{ color: "#bdbdbd", lineHeight: 1.5 }}>
        External records are stored as unverified candidates. Screening scores do not publish listings or enable outreach.
      </p>

      {loading && <p role="status" data-testid="status-ingestion-loading">Loading ingestion health…</p>}
      {error && <p role="alert" data-testid="status-ingestion-error">{error}</p>}
      {health && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 24 }}>
            {[
              { label: "Total candidates", value: health.metrics.totalCandidates.toLocaleString(), id: "candidates" },
              { label: "Promoted", value: health.metrics.promoted.toLocaleString(), id: "promoted" },
              { label: "Restaurants", value: health.metrics.restaurants.toLocaleString(), id: "restaurants" },
              { label: "Outreach eligible", value: health.metrics.eligible?.toLocaleString() ?? "Not tracked", id: "eligible" },
            ].map((item) => (
              <div key={item.id} style={{ border: "1px solid #393939", borderRadius: 12, padding: 18, background: "#1b1b1b" }}>
                <div style={{ color: "#bdbdbd", fontSize: 14 }}>{item.label}</div>
                <strong data-testid={`metric-ingestion-${item.id}`} style={{ display: "block", fontSize: 26, marginTop: 8 }}>{item.value}</strong>
              </div>
            ))}
          </div>
          <section style={{ border: "1px solid #393939", borderRadius: 12, padding: 18, background: "#1b1b1b", marginTop: 20 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 19 }}>Suppressed sources</h2>
            {health.suppressedSources.length === 0
              ? <p data-testid="status-ingestion-no-suppressed" style={{ color: "#bdbdbd", margin: 0 }}>No sources suppressed in this server process.</p>
              : <ul style={{ margin: 0, paddingLeft: 22 }}>
                  {health.suppressedSources.map((name) => <li key={name} data-testid={`source-suppressed-${name}`}>{name}</li>)}
                </ul>}
          </section>
        </>
      )}
    </section>
  );
}