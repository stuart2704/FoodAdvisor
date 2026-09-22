import { useEffect, useState } from "react";

const errorTypes = [
  "timeout",
  "network_error",
  "auth_error",
  "db_error",
  "validation_error",
  "rate_limit",
  "unknown_error",
] as const;

type ErrorType = (typeof errorTypes)[number];

interface ErrorMetric {
  error_type: ErrorType;
  engine: string;
  count: number;
}

function isErrorMetrics(value: unknown): value is ErrorMetric[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => {
      if (!entry || typeof entry !== "object") return false;
      const metric = entry as Partial<ErrorMetric>;
      return (
        typeof metric.error_type === "string" &&
        errorTypes.includes(metric.error_type as ErrorType) &&
        typeof metric.engine === "string" &&
        metric.engine.length > 0 &&
        typeof metric.count === "number" &&
        Number.isInteger(metric.count) &&
        metric.count >= 0
      );
    })
  );
}

export default function ErrorPanel() {
  const [errors, setErrors] = useState<ErrorMetric[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | undefined;

    async function loadErrors() {
      if (disposed || pending) return;
      pending = true;
      controller = new AbortController();
      try {
        const response = await fetch("/errors", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Error classifications are unavailable.");
        }
        const data = (await response.json()) as unknown;
        if (!isErrorMetrics(data)) {
          throw new Error("Error metrics returned an unexpected response.");
        }
        if (!disposed) {
          setErrors(data);
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
              : "Error classifications are unavailable.",
          );
        }
      } finally {
        pending = false;
      }
    }

    void loadErrors();
    const interval = window.setInterval(() => void loadErrors(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  return (
    <section className="error-panel" aria-labelledby="error-panel-title">
      <div className="error-panel-heading">
        <div>
          <p className="error-panel-eyebrow">Diagnostics</p>
          <h2 id="error-panel-title">Error Classification</h2>
        </div>
        <span className="error-panel-window">Last 10 minutes</span>
      </div>

      <ul aria-live="polite">
        {errors?.map((metric) => (
          <li key={`${metric.engine}:${metric.error_type}`}>
            <span>
              <strong>{metric.error_type.replace(/_/g, " ")}</strong>
              <small>{metric.engine.replace(/[_-]/g, " ").toUpperCase()}</small>
            </span>
            <b>{metric.count.toLocaleString()}</b>
          </li>
        ))}
        {errors && errors.length === 0 ? (
          <li className="error-panel-empty">
            No classified errors recorded in the last ten minutes.
          </li>
        ) : null}
      </ul>

      <p className={`error-panel-status${error ? " has-error" : ""}`}>
        {error ??
          (errors
            ? "Updates every five seconds from sanitized operational events."
            : "Loading error classifications…")}
      </p>
    </section>
  );
}