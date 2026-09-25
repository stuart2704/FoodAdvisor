import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const regions = ["eu", "us", "apac"] as const;
const regionSchema = z.enum(regions);
const healthSchema = z.enum(["healthy", "degraded", "offline", "unknown"]);
const clusterSchema = z.object({
  region: regionSchema,
  connected: z.boolean(),
  status: z.enum(["healthy", "offline", "unknown"]),
});
const summarySchema = z.object({
  routing: z.object({
    suppressed: z.array(regionSchema),
    lastFailover: z.object({
      eu: z.string().nullable(),
      us: z.string().nullable(),
      apac: z.string().nullable(),
    }),
  }),
  suppressedRegions: z.array(regionSchema),
  health: z.object({
    eu: healthSchema,
    us: healthSchema,
    apac: healthSchema,
  }),
  clusters: z.object({
    eu: clusterSchema,
    us: clusterSchema,
    apac: clusterSchema,
  }),
});

type Summary = z.infer<typeof summarySchema>;

const sectionStyle = {
  border: "1px solid #393939",
  borderRadius: 12,
  padding: 18,
  background: "#1b1b1b",
  marginTop: 20,
};

export default function OrchestrationPanel() {
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch("/api/dashboard/orchestration/summary", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          navigate("/admin/login", { replace: true });
          throw new Error("Admin session expired.");
        }
        if (!response.ok) throw new Error("Orchestration status is unavailable.");
        const parsed = summarySchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Orchestration status returned an unexpected response.");
        return parsed.data;
      })
      .then(setData)
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(failure instanceof Error ? failure.message : "Orchestration status is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [navigate, revision]);

  return (
    <section aria-labelledby="orchestration-title" style={{ marginTop: 36 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 id="orchestration-title" style={{ margin: 0 }}>Global Orchestration</h2>
          <p style={{ color: "#bdbdbd", margin: "8px 0 0" }}>
            Advisory status only. This panel does not route traffic or start ingestion.
          </p>
          <p data-testid="text-ingestion-schedule" style={{ color: "#bdbdbd", margin: "8px 0 0" }}>
            Automatic candidate ingestion checks hourly; successful runs are at least 12 hours apart.
            Advisory orchestration status is checked at 03:05 UTC daily.
          </p>
        </div>
        <button
          type="button"
          data-testid="button-refresh-orchestration"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading}
          style={{ padding: "9px 14px", border: "1px solid #555", borderRadius: 8, background: "#252525", color: "#fff", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {loading && <p role="status" data-testid="status-orchestration-loading">Checking regional status…</p>}
      {error && <p role="alert" data-testid="status-orchestration-error">{error}</p>}
      {data && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <section style={sectionStyle}>
              <h3 style={{ margin: "0 0 12px" }}>Region Health</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {regions.map((region) => (
                  <li key={region} data-testid={`status-region-health-${region}`}>
                    {region.toUpperCase()}: {data.health[region]}
                  </li>
                ))}
              </ul>
            </section>
            <section style={sectionStyle}>
              <h3 style={{ margin: "0 0 12px" }}>Cluster Heartbeat</h3>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {regions.map((region) => (
                  <li key={region} data-testid={`status-cluster-heartbeat-${region}`}>
                    {region.toUpperCase()}: {data.clusters[region].status}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section style={sectionStyle}>
            <h3 style={{ margin: "0 0 12px" }}>Routing</h3>
            <pre data-testid="status-orchestration-routing" style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify(data.routing, null, 2)}
            </pre>
          </section>
          <section style={sectionStyle}>
            <h3 style={{ margin: "0 0 12px" }}>Suppressed Regions</h3>
            <p data-testid="status-orchestration-suppressed" style={{ margin: 0 }}>
              {data.suppressedRegions.length ? data.suppressedRegions.map((region) => region.toUpperCase()).join(", ") : "None in this server process"}
            </p>
          </section>
        </>
      )}
    </section>
  );
}