import { useEffect, useState } from "react";
import { fetchSocial } from "./api";

interface Metric { succeeded: number; failed: number; averageMs: number | null }
interface HealthReport {
  health: {
    state: "disabled" | "not_configured" | "configured" | "healthy";
    workerConfigured: boolean;
    lastHeartbeatAt: string | null;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
  };
  periodDays: number;
  metrics: {
    generation: Metric;
    scheduling: Metric;
    publishing: Metric & {
      attempts: number;
      pending: number;
      uncertain: number;
      completed: number;
      successRate: number | null;
    };
  };
}

const elapsed = (ms: number | null) => ms === null ? "No successful samples" : `${Math.round(ms)} ms average`;

export function SocialDashboard({ onNavigate }: { onNavigate: (tab: "accounts" | "schedules" | "queue" | "logs") => void }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    fetchSocial<HealthReport>("/health")
      .then(data => { if (mounted) setReport(data); })
      .catch(err => { if (mounted) setError(err instanceof Error ? err.message : "Could not load social health."); });
    return () => { mounted = false; };
  }, []);

  const publishing = report?.metrics.publishing;
  const health = report?.health;
  return (
    <div className="social-dashboard">
      {error && <div className="social-alert">{error}</div>}
      <div className="social-card">
        <h2>Publishing health</h2>
        {!report ? <p>{error ? "Health unavailable." : "Loading measured health..."}</p> : <>
          <strong>{health?.state === "healthy" ? "Healthy" : health?.state === "disabled" ? "Disabled" : health?.state === "not_configured" ? "Not configured" : "Configured — worker not verified"}</strong>
          <p style={{ color: "#aaa" }}>
            {health?.state === "healthy"
              ? "The configured worker completed a cycle within the last 20 minutes."
              : health?.state === "disabled" ? "Master automation is off. Manual publishing may still be available."
              : health?.state === "not_configured" ? "The server runner and external schedule are not both verified."
              : "No recent successful worker heartbeat. Check the external scheduled job before relying on automatic publishing."}
          </p>
          <p>Last worker check: {health?.lastHeartbeatAt ? new Date(health.lastHeartbeatAt).toLocaleString() : "Never recorded"}
            {health?.lastFailureAt && (!health.lastSuccessAt || new Date(health.lastFailureAt) > new Date(health.lastSuccessAt))
              ? " · Last check failed" : ""}
          </p>
          <p>Facebook publishing: supported with a connected account. Instagram publishing and token refresh: not verified as active.</p>
        </>}
      </div>
      <div className="social-card">
        <h2>Performance · last {report?.periodDays ?? 30} days</h2>
        <p style={{ color: "#aaa" }}>Based on recorded events since measurement began. No historical counts are estimated.</p>
        {report && <>
          <div className="ops-summary-grid">
            <article onClick={() => onNavigate("queue")} style={{ cursor: "pointer" }}>
              <span>Draft generation</span>
              <strong>{report.metrics.generation.succeeded} succeeded · {report.metrics.generation.failed} failed</strong>
              <small>{elapsed(report.metrics.generation.averageMs)}</small>
            </article>
            <article onClick={() => onNavigate("schedules")} style={{ cursor: "pointer" }}>
              <span>Scheduling</span>
              <strong>{report.metrics.scheduling.succeeded} succeeded · {report.metrics.scheduling.failed} missed</strong>
              <small>{elapsed(report.metrics.scheduling.averageMs)}</small>
            </article>
            <article onClick={() => onNavigate("logs")} style={{ cursor: "pointer" }}>
              <span>Publishing</span>
              <strong>{publishing?.attempts} attempts · {publishing?.successRate === null ? "No resolved outcomes" : `${publishing?.successRate}% success`}</strong>
              <small>{publishing?.succeeded} published · {publishing?.completed} confirmed after processing · {publishing?.failed} failed · {publishing?.uncertain} uncertain · {publishing?.pending} submitted pending confirmation</small>
              <br /><small>{elapsed(publishing?.averageMs ?? null)} for immediate successes</small>
            </article>
          </div>
          <p style={{ color: "#aaa", fontSize: "0.85rem" }}>Success rate excludes pending and uncertain submissions. Pending is a submission count, not the current queue size; attempts are recorded when a post is claimed.</p>
        </>}
      </div>
    </div>
  );
}