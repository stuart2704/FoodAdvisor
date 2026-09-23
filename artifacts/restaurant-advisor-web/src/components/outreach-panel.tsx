import { useCallback, useEffect, useState } from "react";

interface OutreachStats {
  totalRestaurants: number;
  outreachSent: number;
  claims: number;
}

function isOutreachStats(value: unknown): value is OutreachStats {
  if (!value || typeof value !== "object") return false;
  const stats = value as OutreachStats;
  return (
    Number.isSafeInteger(stats.totalRestaurants) &&
    stats.totalRestaurants >= 0 &&
    Number.isSafeInteger(stats.outreachSent) &&
    stats.outreachSent >= 0 &&
    Number.isSafeInteger(stats.claims) &&
    stats.claims >= 0
  );
}

export default function OutreachPanel() {
  const [stats, setStats] = useState<OutreachStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/dashboard/stats", {
        credentials: "include",
        signal,
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data: unknown = await response.json();
      if (!isOutreachStats(data)) {
        throw new Error("The backend returned an unexpected response");
      }

      setStats(data);
    } catch (failure) {
      if (signal?.aborted) return;
      setStats(null);
      setError(
        failure instanceof Error ? failure.message : "Network or server error",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStats(controller.signal);
    return () => controller.abort();
  }, [loadStats]);

  if (loading) {
    return <p aria-live="polite">Loading outreach stats…</p>;
  }

  if (error) {
    return (
      <div role="alert" style={{ color: "#ff7b7b" }}>
        <p>Error: {error}</p>
        <button type="button" onClick={() => void loadStats()}>
          Retry
        </button>
      </div>
    );
  }

  if (!stats) {
    return <p>No outreach data available.</p>;
  }

  return (
    <section style={{ marginTop: "30px" }} aria-labelledby="outreach-title">
      <h2 id="outreach-title">Outreach Activity</h2>
      <ul>
        <li>Total Restaurants: {stats.totalRestaurants.toLocaleString()}</li>
        <li>Outreach Emails Sent: {stats.outreachSent.toLocaleString()}</li>
        <li>Claims: {stats.claims.toLocaleString()}</li>
      </ul>
    </section>
  );
}