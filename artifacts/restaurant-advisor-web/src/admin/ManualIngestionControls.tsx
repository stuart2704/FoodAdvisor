import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const cities = ["cardiff", "london"] as const;
type City = (typeof cities)[number];

const ingestionResponseSchema = z.object({
  requestedRegion: z.literal("eu"),
  ingestRegion: z.literal("local"),
  execution: z.literal("local"),
  result: z.object({
    status: z.literal("completed"),
    city: z.string(),
    candidatesFetched: z.number(),
    verificationStatus: z.literal("unverified"),
  }),
});
type IngestionResponse = z.infer<typeof ingestionResponseSchema>;

function apiErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" ? value.error : null;
}

export default function ManualIngestionControls({ onSuccess }: { onSuccess?: () => void }) {
  const navigate = useNavigate();
  const [loadingCity, setLoadingCity] = useState<City | null>(null);
  const [status, setStatus] = useState<IngestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(city: City) {
    const label = city === "cardiff" ? "Cardiff" : "London";
    if (!window.confirm(`Run a ${label} OSM candidate import? It has a 12-hour per-city limit and will not publish listings or change the automatic schedule.`)) return;
    setLoadingCity(city);
    setStatus(null);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/ingest?region=eu&city=${city}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      if (response.status === 401) {
        navigate("/admin/login", { replace: true });
        throw new Error("Admin session expired.");
      }
      const json: unknown = await response.json();
      if (!response.ok) throw new Error(apiErrorMessage(json) ?? `${label} ingestion is unavailable.`);
      const parsed = ingestionResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error(`${label} ingestion returned an unexpected response.`);
      setStatus(parsed.data);
      onSuccess?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `${label} ingestion is unavailable.`);
    } finally {
      setLoadingCity(null);
    }
  }

  return (
    <section aria-labelledby="manual-ingestion-title" style={{ border: "1px solid #393939", borderRadius: 12, padding: 18, background: "#1b1b1b", marginTop: 24 }}>
      <h2 id="manual-ingestion-title" style={{ margin: "0 0 12px" }}>Manual Ingestion</h2>
      <p style={{ color: "#bdbdbd", lineHeight: 1.5 }}>
        Run Cardiff or London on this API server. Regional routing is advisory; no traffic is dispatched to a cluster.
        Only unverified OSM candidates are stored. Manual imports have a 12-hour per-city limit
        and do not change the automatic all-city schedule.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {cities.map((city) => (
          <button
            key={city}
            type="button"
            data-testid={`button-ingest-${city}`}
            onClick={() => void run(city)}
            disabled={loadingCity !== null}
            style={{ padding: "9px 14px", border: "1px solid #555", borderRadius: 8, background: "#252525", color: "#fff", cursor: "pointer" }}
          >
            {loadingCity === city ? "Importing…" : `Ingest ${city === "cardiff" ? "Cardiff" : "London"}`}
          </button>
        ))}
      </div>
      {loadingCity && <p role="status" data-testid="status-manual-ingestion-loading">Running ingestion…</p>}
      {error && <p role="alert" data-testid="status-manual-ingestion-error">{error}</p>}
      {status && (
        <>
          <p role="status" data-testid="status-manual-ingestion-success">
            {status.result.candidatesFetched} {status.result.city} candidates fetched. New records are unverified; duplicates are skipped.
          </p>
          <pre data-testid="status-manual-ingestion-result" style={{ marginTop: 15, background: "#111", borderRadius: 8, padding: 12, overflow: "auto" }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </>
      )}
    </section>
  );
}