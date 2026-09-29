import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../styles/admin-operations.css";

type Count = { today: number; total: number; latest: string | null };
type Diagnostic = {
  success: boolean;
  checkedAt: string;
  dayStartUtc: string;
  grid: {
    automationEnabled: boolean;
    initialized: boolean;
    lastRunAt: string | null;
    pointsAttemptedToday: number;
    month: { calls: number; maxCalls: number; estimatedCostCents: number; budgetCents: number };
  };
  external: {
    lastSuccessfulScheduledRunAt: string | null;
    lastAttemptedScheduledRunAt: string | null;
    lastScheduledErrorSummary: string | null;
    candidates: {
      today: number;
      total: number;
      bySource: { source: string; today: number; total: number }[];
    };
  };
  cities: { city: string; source: string; lastRunAt: string }[];
  restaurants: {
    today: number;
    total: number;
    bySource: { source: string; total: number }[];
  };
  outreach: {
    schedulerEnabled: boolean;
    attempts: Count;
    confirmedSends: Count;
    failures: Count;
    classifiedReplies: Count;
  };
};

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "No recorded run";
}

function Metric({ label, today, total }: { label: string; today: number; total: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{today.toLocaleString()}</strong>
      <small>Today UTC · {total.toLocaleString()} total</small>
    </article>
  );
}

export default function IngestionDiagnostic({ refreshKey = 0 }: { refreshKey?: number }) {
  const navigate = useNavigate();
  const [data, setData] = useState<Diagnostic | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/dashboard/operations/ingestion-diagnostic", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          navigate("/admin/login", { replace: true });
          return;
        }
        if (!response.ok) throw new Error("Diagnostic data is temporarily unavailable.");
        const result = (await response.json()) as Diagnostic;
        if (!result.success || !result.checkedAt || !result.outreach || !result.restaurants) {
          throw new Error("Diagnostic data returned an unexpected response.");
        }
        setData(result);
        setError("");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Diagnostic data is unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [navigate, refreshKey, revision]);

  return (
    <section aria-labelledby="ingestion-diagnostic-title" className="ops-content" style={{ marginTop: 32 }}>
      <div className="ops-header">
        <div>
          <h2 id="ingestion-diagnostic-title">Ingestion & outreach diagnostic</h2>
          <p className="ops-description">Database-backed activity. Today means since 00:00 UTC; counts are recorded outcomes, not scheduled promises.</p>
        </div>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>Refresh diagnostic</button>
      </div>
      {loading && !data && <p role="status">Loading activity…</p>}
      {error && <p role="alert" className="ops-state ops-state-error">{error}{data ? " The figures below are from the last successful refresh." : ""}</p>}
      {data && (
        <>
          <div className="ops-summary-grid">
            <Metric label="Restaurant listings collected" today={data.restaurants.today} total={data.restaurants.total} />
            <Metric label="External candidates recorded" today={data.external.candidates.today} total={data.external.candidates.total} />
            <Metric label="Email send attempts" today={data.outreach.attempts.today} total={data.outreach.attempts.total} />
            <Metric label="Confirmed emails sent" today={data.outreach.confirmedSends.today} total={data.outreach.confirmedSends.total} />
            <Metric label="Replies classified" today={data.outreach.classifiedReplies.today} total={data.outreach.classifiedReplies.total} />
            <Metric label="Email send failures" today={data.outreach.failures.today} total={data.outreach.failures.total} />
          </div>
          <div className="ops-card-grid">
            <article className="ops-card">
              <h3>Scheduled imports</h3>
              <p>Google global crawl: <strong>{data.grid.automationEnabled ? "On" : "Off"}</strong>
                {data.grid.initialized ? "" : " · first crawl not activated"}</p>
              <p>Google points attempted today: <strong>{data.grid.pointsAttemptedToday}</strong></p>
              <p>Last Google run: {when(data.grid.lastRunAt)}</p>
              <p>Last successful scheduled external import: {when(data.external.lastSuccessfulScheduledRunAt)}</p>
              <p>Last attempted scheduled external import: {when(data.external.lastAttemptedScheduledRunAt)}</p>
              {data.external.lastScheduledErrorSummary && <p role="alert">Latest import incomplete: {data.external.lastScheduledErrorSummary}</p>}
              <small>Completed cities are saved; unfinished cities retry at the next hourly check. No candidates are published automatically.</small>
            </article>
            <article className="ops-card">
              <h3>Google Places allowance</h3>
              <p>Recorded calls this UTC month: <strong>{data.grid.month.calls} / {data.grid.month.maxCalls}</strong></p>
              <p>Reserved estimate: £{(data.grid.month.estimatedCostCents / 100).toFixed(2)} · app budget: £{(data.grid.month.budgetCents / 100).toFixed(2)}</p>
              <small>This app estimate is not a Google invoice or a guaranteed spending cap.</small>
            </article>
            <article className="ops-card">
              <h3>Source breakdown</h3>
              <p>Listings: {data.restaurants.bySource.length
                ? data.restaurants.bySource.map((row) => `${row.source} ${row.total}`).join(" · ")
                : "None recorded"}</p>
              <p>Candidates: {data.external.candidates.bySource.length
                ? data.external.candidates.bySource.map((row) => `${row.source} ${row.today} today / ${row.total} total`).join(" · ")
                : "None recorded"}</p>
              <p>Outreach schedule: <strong>{data.outreach.schedulerEnabled ? "Enabled" : "Disabled"}</strong></p>
              <small>Attempts and queued campaigns are not confirmed sends. Replies count only after classification.</small>
            </article>
          </div>
          <section className="ops-subsection">
            <h3>Recent city activity</h3>
            {data.cities.length === 0 ? <p className="ops-empty">No completed manual city imports or recorded Google import calls.</p> :
              <div className="ops-table-wrap"><table>
                <thead><tr><th>City</th><th>Activity</th><th>Recorded at</th></tr></thead>
                <tbody>{data.cities.map((row) => (
                  <tr key={`${row.source}:${row.city}`}>
                    <td>{row.city}</td><td>{row.source}</td><td>{when(row.lastRunAt)}</td>
                  </tr>
                ))}</tbody>
              </table></div>}
            <p className="ops-scope">Shows up to 20 recent city records. External candidates are unpublished until reviewed.</p>
          </section>
          <p className="ops-updated">Checked {when(data.checkedAt)} · UTC day began {new Date(data.dayStartUtc).toUTCString()}</p>
        </>
      )}
    </section>
  );
}