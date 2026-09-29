import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AdminLayout } from "../../components/admin/AdminLayout";
import { RequireAdmin } from "../../components/admin/RequireAdmin";
import ErrorLogPanel from "../../components/error-log-panel";
import GlobalDirectoryAnalyticsPanel from "../../components/global-directory-analytics-panel";
import GmailAutomationPanel from "../../components/gmail-automation-panel";
import OutreachPanel from "../../components/outreach-panel";
import RestaurantIngestionPanel from "../../components/restaurant-ingestion-panel";
import SummaryPanel from "../../components/summary-panel";
import "./dashboard.css";

type Count = { today: number; total: number; latest: string | null };
type Diagnostic = {
  success: boolean;
  checkedAt: string;
  external: {
    lastSuccessfulScheduledRunAt: string | null;
    lastAttemptedScheduledRunAt: string | null;
    lastScheduledErrorSummary: string | null;
    candidates: { today: number; total: number };
  };
  restaurants: { today: number; total: number };
  outreach: {
    schedulerEnabled: boolean;
    attempts: Count;
    confirmedSends: Count;
    failures: Count;
  };
};

const investigationLinks = [
  { to: "/admin/ingestion", title: "External ingestion", description: "Scheduled imports and source diagnostics" },
  { to: "/admin/outreach", title: "Outreach", description: "Send activity and automation controls" },
  { to: "/admin/candidates", title: "Candidates", description: "Review unpublished external leads" },
  { to: "/admin/errors", title: "Errors", description: "Investigate recorded failures" },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is Count {
  return isRecord(value)
    && typeof value.today === "number" && Number.isFinite(value.today)
    && typeof value.total === "number" && Number.isFinite(value.total)
    && (value.latest === null || typeof value.latest === "string");
}

function isDiagnostic(value: unknown): value is Diagnostic {
  if (!isRecord(value) || !isRecord(value.external) || !isRecord(value.restaurants) || !isRecord(value.outreach)) return false;
  const candidates = value.external.candidates;
  return value.success === true
    && typeof value.checkedAt === "string"
    && !Number.isNaN(Date.parse(value.checkedAt))
    && (value.external.lastSuccessfulScheduledRunAt === null || typeof value.external.lastSuccessfulScheduledRunAt === "string")
    && (value.external.lastAttemptedScheduledRunAt === null || typeof value.external.lastAttemptedScheduledRunAt === "string")
    && (value.external.lastScheduledErrorSummary === null || typeof value.external.lastScheduledErrorSummary === "string")
    && isRecord(candidates)
    && typeof candidates.today === "number" && Number.isFinite(candidates.today)
    && typeof candidates.total === "number" && Number.isFinite(candidates.total)
    && typeof value.restaurants.today === "number" && Number.isFinite(value.restaurants.today)
    && typeof value.restaurants.total === "number" && Number.isFinite(value.restaurants.total)
    && typeof value.outreach.schedulerEnabled === "boolean"
    && isCount(value.outreach.attempts)
    && isCount(value.outreach.confirmedSends)
    && isCount(value.outreach.failures);
}

function formatDate(value: string | null): string {
  if (!value) return "None recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Invalid date recorded"
    : date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function Metric({ label, count, accent, failure }: {
  label: string;
  count: { today: number; total: number };
  accent?: boolean;
  failure?: boolean;
}) {
  return (
    <article className={`ad-metric${accent ? " ad-metric--accent" : ""}${failure && count.today > 0 ? " ad-metric--failure" : ""}`}>
      <span className="ad-metric-label">{label}</span>
      <strong className="ad-metric-value" data-testid={`value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
        {count.today.toLocaleString()}
      </strong>
      <small>{count.total.toLocaleString()} all time</small>
    </article>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<{ isDev: boolean } | null>(null);
  const [isRunningEngines, setIsRunningEngines] = useState(false);
  const [data, setData] = useState<Diagnostic | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/status", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Status request failed.");
        return (await response.json()) as { isDev?: unknown };
      })
      .then((result) => setStatus({ isDev: result.isDev === true }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setStatus(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    let active = true;
    async function load() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setLoading(true);
      try {
        const response = await fetch("/api/dashboard/operations/ingestion-diagnostic", {
          credentials: "include",
          cache: "no-store",
          signal: request.signal,
        });
        if (response.status === 401) {
          navigate("/admin/login", { replace: true });
          return;
        }
        if (!response.ok) throw new Error("Could not retrieve the operations diagnostic.");
        const result: unknown = await response.json();
        if (!isDiagnostic(result)) throw new Error("The operations diagnostic returned an unexpected response.");
        if (active && !request.signal.aborted) {
          setData(result);
          setError("");
          setNow(Date.now());
        }
      } catch (cause) {
        if (active && !request.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Operations data is unavailable.");
        }
      } finally {
        if (active && !request.signal.aborted) setLoading(false);
      }
    }
    void load();
    const refreshTimer = window.setInterval(() => void load(), 60_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [navigate, revision]);

  async function startEngines() {
    const confirmed = window.confirm("Run one engine cycle now? This may send eligible outreach emails.");
    if (!confirmed) return;
    setIsRunningEngines(true);
    try {
      const response = await fetch("/dev/run-engines", { method: "POST", credentials: "include" });
      const result = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Engine cycle failed.");
      window.alert(result.message ?? "Engine cycle executed.");
      setRevision((value) => value + 1);
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "Engine cycle failed.");
    } finally {
      setIsRunningEngines(false);
    }
  }

  async function logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    navigate("/admin/login", { replace: true });
  }

  const stale = data !== null && now - Date.parse(data.checkedAt) > 120_000;

  return (
    <RequireAdmin>
      <AdminLayout>
        <div className="ad-overview">
          <header className="ad-top">
            <div>
              <p className="ad-eyebrow">The Food Advisor / Operations</p>
              <h1>What happened today.</h1>
              <p className="ad-intro">Recorded outcomes, not work scheduled or leads waiting for review. Today starts at 00:00 UTC.</p>
            </div>
            <button className="ad-quiet-button" type="button" onClick={() => void logout()} data-testid="button-sign-out">Sign out</button>
          </header>

          {status?.isDev && (
            <aside className="ad-dev" aria-label="Development tools">
              <p>Development mode only · Running a cycle may send eligible outreach emails.</p>
              <button className="ad-quiet-button" type="button" disabled={isRunningEngines} onClick={() => void startEngines()} data-testid="button-run-engines">
                {isRunningEngines ? "Running engine cycle…" : "Run engine cycle"}
              </button>
            </aside>
          )}

          <div className="ad-toolbar">
            <p data-testid="text-checked-at">
              {data ? <>Checked <time dateTime={data.checkedAt}>{formatDate(data.checkedAt)}</time>{loading ? " · Refreshing…" : ""}</> : loading ? "Checking recorded activity…" : "Activity could not be checked"}
            </p>
            <button className="ad-quiet-button" type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading} data-testid="button-refresh-overview">
              Refresh now
            </button>
          </div>

          {(error || stale) && (
            <div className="ad-alert" role="alert" data-testid="status-diagnostic-warning">
              <strong>{error ? "Refresh failed" : "Data may be out of date"}</strong>
              <p>{error || "The latest diagnostic is more than two minutes old."}{data ? " Figures below are from the last successful check, not live activity." : " Try refreshing or investigate the errors page."}</p>
            </div>
          )}

          {loading && !data && !error && <div className="ad-skeleton" role="status" aria-label="Loading operations activity" />}

          {data && (
            <>
              <div className="ad-status" data-testid="status-scheduled-import">
                <div>
                  <strong>Last successful scheduled external import</strong>
                   <p>Last attempt: {formatDate(data.external.lastAttemptedScheduledRunAt)}. Completed cities are saved even when another city fails.</p>
                   {data.external.lastScheduledErrorSummary && <p role="alert">Latest import incomplete: {data.external.lastScheduledErrorSummary}</p>}
                </div>
                <div className="ad-status-time">
                  <span>Recorded success</span>
                  <time dateTime={data.external.lastSuccessfulScheduledRunAt ?? undefined}>{formatDate(data.external.lastSuccessfulScheduledRunAt)}</time>
                </div>
              </div>

              <section className="ad-section" aria-labelledby="intake-title">
                <div className="ad-section-head">
                  <h2 id="intake-title">Intake</h2>
                  <p>Two different stages of the pipeline</p>
                </div>
                <div className="ad-metrics">
                  <Metric label="External candidates recorded" count={data.external.candidates} />
                  <Metric label="Restaurant listings recorded" count={data.restaurants} />
                </div>
                <p className="ad-note">External candidates are not public listings until reviewed. Recorded counts do not establish whether the scheduled import ran successfully today.</p>
              </section>

              <section className="ad-section" aria-labelledby="outreach-title">
                <div className="ad-section-head">
                  <h2 id="outreach-title">Outreach</h2>
                  <p>Recorded email activity · today UTC</p>
                </div>
                <div className="ad-metrics">
                  <Metric label="Confirmed emails sent" count={data.outreach.confirmedSends} accent />
                  <Metric label="Send failures" count={data.outreach.failures} failure />
                  <Metric label="Send attempts" count={data.outreach.attempts} />
                  <article className="ad-metric">
                    <span className="ad-metric-label">Outreach scheduler</span>
                    <strong className="ad-metric-value" style={{ fontSize: "1.5rem", letterSpacing: "-.025em" }} data-testid="status-outreach-scheduler">
                      {data.outreach.schedulerEnabled ? "Enabled" : "Disabled"}
                    </strong>
                    <small>Configuration, not proof that an email was sent</small>
                  </article>
                </div>
                <p className="ad-note">Attempts are not confirmed sends. Last confirmed send: {formatDate(data.outreach.confirmedSends.latest)} · Last recorded failure: {formatDate(data.outreach.failures.latest)}.</p>
              </section>
            </>
          )}

          <section className="ad-section" aria-labelledby="investigate-title">
            <div className="ad-section-head">
              <h2 id="investigate-title">Investigate</h2>
              <p>Go to the underlying records and controls</p>
            </div>
            <nav className="ad-links" aria-label="Operations investigation">
              {investigationLinks.map((item) => (
                <Link className="ad-link" to={item.to} key={item.to} data-testid={`link-${item.to.split("/").pop()}`}>
                  <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  <span className="ad-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </nav>
          </section>

          <details className="ad-details" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary data-testid="button-toggle-detailed-panels">Show detailed dashboard panels</summary>
            <p>Legacy reports and controls are available here when needed.</p>
            {detailsOpen && (
              <div className="ad-detail-content">
                <SummaryPanel />
                <OutreachPanel />
                <GmailAutomationPanel />
                <ErrorLogPanel />
                <RestaurantIngestionPanel />
                <GlobalDirectoryAnalyticsPanel />
              </div>
            )}
          </details>
        </div>
      </AdminLayout>
    </RequireAdmin>
  );
}