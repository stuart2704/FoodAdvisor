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

  async function loadPlan(signal?: AbortSignal) {
    const response = await fetch(base, { credentials: "include", cache: "no-store", signal });
    if (response.status === 401) {
      navigate("/admin/login", { replace: true });
      return;
    }
    if (!response.ok) throw new Error("The open-data rollout is unavailable.");
    const data = (await response.json()) as GovernmentSourceReadiness;
    if (!data.success || !Array.isArray(data.sources)) throw new Error("The rollout returned an unexpected response.");
    if (!signal?.aborted) setPlan(data);
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadPlan(controller.signal)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The pilot plan is unavailable.");
      });
    return () => controller.abort();
  }, [navigate]);

  async function control(source: string, action: "approve" | "pause" | "resume") {
    setPending(`${source}:${action}`);
    setError("");
    try {
      const response = await fetch(`${base}/control`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, action }),
      });
      if (response.status === 401) {
        navigate("/admin/login", { replace: true });
        return;
      }
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "The source decision could not be saved.");
      }
      await loadPlan();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The source decision could not be saved.");
    } finally {
      setPending(null);
    }
  }

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
          <h2 id="government-source-title">Official data · publication review</h2>
          <p className="ops-description">
            Review the sources and sample records before approving any unclaimed public listings.
            Imports remain paused until account-level costs can be measured safely.
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
              <p><strong>{plan.publishingEnabled ? "Enabled" : "Paused"}</strong> · {plan.plannedDailyRunUtc}</p>
              <p>When eligible: up to {plan.initialDailyLimitPerSource} new listings per approved source daily.</p>
              <small>Source approval alone cannot enable publishing. The OpenStreetMap claim and rights gates are unchanged.</small>
            </article>
            <article className="ops-card">
              <h3>Additional monthly budget</h3>
              <p>Target: <strong>£{plan.additionalMonthlyBudgetGbp}</strong> · pause imports at £{plan.pauseAtAdditionalGbp} over the pre-import baseline.</p>
              <small>
                No Google, AI, or outreach calls are made by this importer. Billing is {plan.costMeterConnected ? "connected" : "not connected"}.
                Row limits cannot enforce a monetary cap. Do not use an account-wide shutdown cap: it could take the public site offline.
              </small>
              <p role="status" className="ops-state">{plan.billingBlocker}</p>
            </article>
          </div>
          <section className="ops-subsection">
            <h3>Source review</h3>
            <div className="ops-table-wrap">
              <table>
                <thead><tr><th>Market & source</th><th>Reuse terms</th><th>Decision</th><th>Actions</th></tr></thead>
                <tbody>
                  {plan.sources.map((source) => (
                    <tr key={source.code}>
                      <td><strong>{source.region}</strong><br /><a href={source.datasetUrl} target="_blank" rel="noopener noreferrer">{source.label}</a></td>
                      <td><a href={source.licenceUrl} target="_blank" rel="noopener noreferrer">Source terms</a></td>
                      <td>{!source.publishable ? "Preview only — inspection history and reuse review needed" :
                        source.approved ? source.paused ? "Approved · paused" : "Approved · scheduled" : "Awaiting review"}</td>
                      <td>
                        <button type="button" disabled={pending !== null} onClick={() => void runPreview(source.code)}>
                          {pending === source.code ? "Checking…" : "Preview 25"}
                        </button>{" "}
                        {source.publishable && !source.approved && <button type="button" disabled={pending !== null} onClick={() => void control(source.code, "approve")}>Approve source</button>}
                        {source.publishable && source.approved && <button type="button" disabled={pending !== null || source.paused} onClick={() => void control(source.code, "pause")}>Pause</button>}
                        {source.publishable && source.approved && source.paused && <button type="button" disabled={pending !== null || !plan.costMeterConnected} onClick={() => void control(source.code, "resume")}>Resume</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ops-scope">UK hygiene data is updated daily but does not prove a venue is open. French records exclude recorded closures. NYC inspection history includes not-yet-inspected applicants, so it cannot be approved here. A preview does not publish anything.</p>
          </section>
          <section className="ops-subsection">
            <h3>Import audit</h3>
            {plan.recentRuns.length === 0 ? <p className="ops-empty">No import runs yet.</p> :
              <div className="ops-table-wrap"><table>
                <thead><tr><th>Date (UTC)</th><th>Source</th><th>Status</th><th>Scanned</th><th>New</th><th>Updated</th><th>Skipped</th></tr></thead>
                <tbody>{plan.recentRuns.map((run) => <tr key={`${run.source}:${run.runDay}`}>
                  <td>{run.runDay}</td><td>{run.source}</td><td>{run.status}{run.error ? ` · ${run.error}` : ""}</td>
                  <td>{run.scanned}</td><td>{run.inserted}</td><td>{run.updated}</td><td>{run.skipped}</td>
                </tr>)}</tbody>
              </table></div>}
          </section>
          {plan.recentDecisions.length > 0 && <section className="ops-subsection">
            <h3>Review and pause history</h3>
            <div className="ops-table-wrap"><table><thead><tr><th>When</th><th>Source</th><th>Decision</th></tr></thead>
              <tbody>{plan.recentDecisions.map((decision, index) => <tr key={`${decision.source}:${decision.createdAt}:${index}`}>
                <td>{new Date(decision.createdAt).toLocaleString()}</td><td>{decision.source}</td><td>{decision.action}</td>
              </tr>)}</tbody>
            </table></div>
          </section>}
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