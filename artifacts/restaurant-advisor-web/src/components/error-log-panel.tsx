import { getEvents } from "../lib/dashboard-api";
import { useDashboardResource } from "../hooks/use-dashboard-resource";

interface DashboardEvent {
  id?: string;
  time: string;
  type: string;
  message: string;
  category?: string;
}

function isDashboardEvents(value: unknown): value is DashboardEvent[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (event: unknown) => {
        if (!event || typeof event !== "object") return false;
        const item = event as DashboardEvent;
        return (
          typeof item.time === "string" &&
          Number.isFinite(Date.parse(item.time)) &&
          typeof item.type === "string" &&
          typeof item.message === "string" &&
          (item.category === undefined || typeof item.category === "string")
        );
      },
    )
  );
}

export default function ErrorLogPanel() {
  const state = useDashboardResource(getEvents, isDashboardEvents);
  const errors = (state.data ?? [])
    .filter((event) => event.type === "error")
    .reverse();

  if (state.loading) {
    return <p aria-live="polite">Loading recent errors…</p>;
  }

  if (state.error) {
    return (
      <div role="alert" style={{ color: "#ff7b7b", marginTop: 30 }}>
        <p>Error: {state.error}</p>
        <button type="button" onClick={state.refresh}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="error-log-title"
      style={{
        marginTop: 30,
        border: "1px solid #303030",
        borderRadius: 10,
        padding: 18,
        background: "#171717",
      }}
    >
      <h2 id="error-log-title" style={{ marginTop: 0 }}>
        Recent Errors
      </h2>
      <p style={{ color: "#aaa" }}>
        Error details from the latest 200 process events. This process-local
        list resets when the server restarts.
      </p>
      {errors.length === 0 ? (
        <p>No recent errors.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {errors.map((event, index) => (
            <li
              key={`${event.time}-${index}`}
              style={{
                borderBottom: "1px solid #303030",
                padding: "8px 0",
              }}
            >
              <time dateTime={event.time} style={{ color: "#aaa" }}>
                {new Date(event.time).toLocaleString()}
              </time>
              <strong style={{ display: "block", margin: "4px 0" }}>
                {(event.category ?? "unknown").replaceAll("_", " ")}
              </strong>
              <span>{event.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}