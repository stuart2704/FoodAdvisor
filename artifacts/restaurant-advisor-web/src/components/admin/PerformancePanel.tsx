import { useEffect, useState } from "react";

interface EnginePerformanceMetric {
  total: number;
  errors: number;
  successes: number;
  error_rate: number;
  success_rate: number;
  avg_latency_ms: number | null;
}

type EnginePerformanceMetrics = Record<string, EnginePerformanceMetric>;

function isMetric(value: unknown): value is EnginePerformanceMetric {
  if (!value || typeof value !== "object") return false;
  const metric = value as Partial<EnginePerformanceMetric>;
  return (
    typeof metric.total === "number" &&
    Number.isFinite(metric.total) &&
    metric.total >= 0 &&
    typeof metric.errors === "number" &&
    Number.isFinite(metric.errors) &&
    metric.errors >= 0 &&
    typeof metric.successes === "number" &&
    Number.isFinite(metric.successes) &&
    metric.successes >= 0 &&
    typeof metric.error_rate === "number" &&
    Number.isFinite(metric.error_rate) &&
    metric.error_rate >= 0 &&
    metric.error_rate <= 1 &&
    typeof metric.success_rate === "number" &&
    Number.isFinite(metric.success_rate) &&
    metric.success_rate >= 0 &&
    metric.success_rate <= 1 &&
    (metric.avg_latency_ms === null ||
      (typeof metric.avg_latency_ms === "number" &&
        Number.isFinite(metric.avg_latency_ms) &&
        metric.avg_latency_ms >= 0))
  );
}

function isPerformanceMetrics(
  value: unknown,
): value is EnginePerformanceMetrics {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([engine, metric]) => engine.length > 0 && isMetric(metric),
  );
}

export default function PerformancePanel() {
  const [metrics, setMetrics] = useState<EnginePerformanceMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;

    async function loadPerformance() {
      if (disposed || pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch("/performance", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Engine performance metrics are unavailable.");
        }
        const data = (await response.json()) as unknown;
        if (!isPerformanceMetrics(data)) {
          throw new Error("Performance returned an unexpected response.");
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
              : "Engine performance metrics are unavailable.",
          );
        }
      } finally {
        pending = false;
      }
    }

    void loadPerformance();
    const interval = window.setInterval(() => void loadPerformance(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  const entries = metrics ? Object.entries(metrics) : [];

  return (
    <section
      className="performance-panel"
      aria-labelledby="performance-panel-title"
    >
      <div className="performance-panel-heading">
        <div>
          <p className="performance-panel-eyebrow">Reliability</p>
          <h2 id="performance-panel-title">Engine Performance</h2>
        </div>
        <span className="performance-panel-window">Last 5 minutes</span>
      </div>

      <ul aria-live="polite">
        {entries.map(([engine, metric]) => (
          <li key={engine}>
            <strong>{engine.replace(/[_-]/g, " ").toUpperCase()}</strong>
            <dl>
              <div>
                <dt>Avg latency</dt>
                <dd>
                  {metric.avg_latency_ms === null
                    ? "N/A"
                    : `${metric.avg_latency_ms.toLocaleString()} ms`}
                </dd>
              </div>
              <div>
                <dt>Error rate</dt>
                <dd>{(metric.error_rate * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Success rate</dt>
                <dd>{(metric.success_rate * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Total logs</dt>
                <dd>{metric.total.toLocaleString()}</dd>
              </div>
            </dl>
          </li>
        ))}
        {metrics && entries.length === 0 ? (
          <li className="performance-panel-empty">
            No engine activity recorded in the last five minutes.
          </li>
        ) : null}
      </ul>

      <p className={`performance-panel-status${error ? " has-error" : ""}`}>
        {error ??
          (metrics
            ? "Updates every five seconds from sanitized operational events."
            : "Loading engine performance…")}
      </p>
    </section>
  );
}