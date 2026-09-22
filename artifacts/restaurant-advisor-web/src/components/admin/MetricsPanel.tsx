import { useEffect, useState } from "react";

interface OperationalMetrics {
  ai_requests_last_minute: number;
  automation_tasks_last_minute: number;
  queue_jobs_last_minute: number;
  api_calls_last_minute: number;
  db_queries_last_minute: number;
}

const metricLabels: Array<[keyof OperationalMetrics, string]> = [
  ["ai_requests_last_minute", "AI Requests"],
  ["automation_tasks_last_minute", "Automation Tasks"],
  ["queue_jobs_last_minute", "Queue Jobs"],
  ["api_calls_last_minute", "API Calls"],
  ["db_queries_last_minute", "DB Queries"]
];

function isOperationalMetrics(value: unknown): value is OperationalMetrics {
  if (!value || typeof value !== "object") return false;
  const metrics = value as Partial<OperationalMetrics>;
  return metricLabels.every(
    ([key]) =>
      typeof metrics[key] === "number" &&
      Number.isFinite(metrics[key]) &&
      metrics[key]! >= 0
  );
}

export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<OperationalMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;

    async function loadMetrics() {
      if (disposed || pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch("/metrics", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("Throughput metrics are unavailable.");
        }
        const data = (await response.json()) as unknown;
        if (!isOperationalMetrics(data)) {
          throw new Error("Metrics returned an unexpected response.");
        }
        if (!disposed) {
          setMetrics(data);
          setError(null);
        }
      } catch (caught) {
        if (
          !disposed &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Throughput metrics are unavailable."
          );
        }
      } finally {
        pending = false;
      }
    }

    void loadMetrics();
    const interval = window.setInterval(() => void loadMetrics(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  return (
    <section className="metrics-panel" aria-labelledby="metrics-panel-title">
      <div className="metrics-panel-heading">
        <div>
          <p className="metrics-panel-eyebrow">Observed activity</p>
          <h2 id="metrics-panel-title">Engine Throughput</h2>
        </div>
        <span className="metrics-panel-window">Last 60 seconds</span>
      </div>
      <div className="metrics-panel-grid" aria-live="polite">
        {metricLabels.map(([key, label]) => (
          <div className="metrics-panel-card" key={key}>
            <span>{label}</span>
            <strong>{metrics ? metrics[key].toLocaleString() : "—"}</strong>
          </div>
        ))}
      </div>
      <p className={`metrics-panel-status${error ? " has-error" : ""}`}>
        {error ??
          (metrics
            ? "Updates every five seconds from sanitized operational events."
            : "Loading throughput metrics…")}
      </p>
    </section>
  );
}