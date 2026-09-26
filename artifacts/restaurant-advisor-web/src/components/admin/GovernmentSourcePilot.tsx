import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GovernmentSourcePreview, GovernmentSourceReadiness } from "@workspace/api-client-react";
import "../../styles/admin-operations.css";

const base = "/api/dashboard/operations/government-sources";

export default function GovernmentSourcePilot() {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<GovernmentSourceReadiness | null>(null);
  const [preview, setPreview] = useState<GovernmentSourcePreview | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(base, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          navigate("/admin/login", { replace: true });
          return;
        }
        if (!response.ok) throw new Error("The open-data pilot plan is unavailable.");
        const data = (await response.json()) as GovernmentSourceReadiness;
        if (!data.success || !Array.isArray(data.sources)) throw new Error("The pilot plan returned an unexpected response.");
        if (!controller.signal.aborted) setPlan(data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The pilot plan is unavailable.");
      });
    return () => controller.abort();
  }, [navigate]);

  async function runPreview(source: string) {
    setPending(source);
    setPreview(null);
    setError("");
    try {
      const response = await fetch(`${base}/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, limit: 25 }),
      });
      if (response.status === 401) {
        navigate("/admin/login", { replace: true });
        return;
      }
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? "The source preview could not be loaded.");
      }
      const result = (await response.json()) as GovernmentSourcePreview;
      if (!result.success || !Array.isArray(result.listings)) throw new Error("The source returned an unexpected preview.");
      setPreview(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The source preview could not be loaded.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="government-source-title" className="ops-content" style={{ marginTop: 32 }}>
      <div className="ops-header">
        <div>
          <h2 id="government-source-title">Free-data rollout · baseline & dry-run</h2>
          <p className="ops-description">
            Check official UK, French, and New York City source records before starting unclaimed public listings.
            Dry-runs fetch one small page and do not save or publish anything.
          </p>
        </div>
      </div>
      {error && <p role="alert" className="ops-state ops-state-error">{error}</p>}
      {!plan && !error && <p role="status">Loading pilot plan…</p>}
      {plan && (
        <>
          <div className="ops-card-grid">
            <article className="ops-card">
              <h3>Publishing schedule</h3>
              <p><strong>{plan.publishingEnabled ? "Enabled" : "Paused for baseline"}</strong> · planned {plan.plannedDailyRunUtc}</p>
              <p>First batch when activated: up to {plan.initialDailyLimitPerSource} records per source per day.</p>
              <small>No automatic import is active. The existing OpenStreetMap approval path is unchanged.</small>
            </article>
            <article className="ops-card">
              <h3>Additional monthly budget</h3>
              <p>Target: <strong>£{plan.additionalMonthlyBudgetGbp}</strong> · pause imports at £{plan.pauseAtAdditionalGbp} over the pre-import baseline.</p>
              <small>
                Source/API fees: £0. No Google or AI calls. Billing is {plan.costMeterConnected ? "connected" : "not connected"} to this page:
                check actual Replit usage before activation and weekly thereafter. Row limits are not a monetary cap.
              </small>
            </article>
          </div>
          <section className="ops-subsection">
            <h3>Official source dry-runs</h3>
            <div className="ops-table-wrap">
              <table>
                <thead><tr><th>Market & source</th><th>Reuse terms</th><th>Action</th></tr></thead>
                <tbody>
                  {plan.sources.map((source) => (
                    <tr key={source.code}>
                      <td><strong>{source.region}</strong><br /><a href={source.datasetUrl} target="_blank" rel="noopener noreferrer">{source.label}</a></td>
                      <td><a href={source.licenceUrl} target="_blank" rel="noopener noreferrer">Source terms</a></td>
                      <td><button type="button" disabled={pending !== null} onClick={() => void runPreview(source.code)}>
                        {pending === source.code ? "Checking…" : "Preview 25"}
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ops-scope">A dry-run shows source quality only. It does not confirm that a venue is open or that any listing is ready to publish.</p>
          </section>
          {preview && (
            <section className="ops-subsection" aria-live="polite">
              <h3>{plan.sources.find((source) => source.code === preview.source)?.region ?? preview.source} · sample</h3>
              <p>Checked {new Date(preview.checkedAt).toLocaleString()} · {preview.scanned} source records · {preview.eligible} usable · {preview.skipped} incomplete or excluded.</p>
              {preview.listings.length === 0
                ? <p className="ops-empty">No usable listings in this page.</p>
                : <div className="ops-table-wrap"><table>
                    <thead><tr><th>Name</th><th>Address</th><th>City</th><th>Coordinates</th></tr></thead>
                    <tbody>{preview.listings.map((listing) => (
                      <tr key={listing.sourceId}>
                        <td>{listing.name}</td>
                        <td>{listing.address}</td>
                        <td>{listing.city}, {listing.country}</td>
                        <td>{listing.coordinatesAvailable ? "Available" : "Missing"}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>}
            </section>
          )}
        </>
      )}
    </section>
  );
}