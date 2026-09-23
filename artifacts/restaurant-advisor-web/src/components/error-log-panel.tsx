import { getErrors } from "../lib/dashboard-api";
import { useDashboardResource } from "../hooks/use-dashboard-resource";

function isErrorCounts(value: unknown): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([category, count]) =>
        /^[a-z][a-z0-9_-]{0,63}$/i.test(category) &&
        typeof count === "number" &&
        Number.isSafeInteger(count) &&
        count >= 0,
    )
  );
}

export default function ErrorLogPanel() {
  const state = useDashboardResource(getErrors, isErrorCounts);
  const categories = Object.entries(state.data ?? {}).sort(
    ([categoryA, countA], [categoryB, countB]) =>
      countB - countA || categoryA.localeCompare(categoryB),
  );

  if (state.loading) {
    return <p aria-live="polite">Loading error summary…</p>;
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
        Error Categories
      </h2>
      <p style={{ color: "#aaa" }}>
        Counts from the latest 200 process events. Values reset when the server
        restarts.
      </p>
      {categories.length === 0 ? (
        <p>No errors recorded.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {categories.map(([category, count]) => (
            <li
              key={category}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                borderBottom: "1px solid #303030",
                padding: "8px 0",
              }}
            >
              <span>{category.replaceAll("_", " ")}</span>
              <strong>{count.toLocaleString()}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}