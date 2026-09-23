import { getSummary, type DashboardStats } from '../lib/dashboard-api';
import { useDashboardResource } from '../hooks/use-dashboard-resource';

function isSummary(value: unknown): value is DashboardStats {
  if (!value || typeof value !== 'object') return false;
  const data = value as DashboardStats;
  return Number.isSafeInteger(data.totalRestaurants) && data.totalRestaurants >= 0
    && Number.isSafeInteger(data.outreachSent) && data.outreachSent >= 0
    && Number.isSafeInteger(data.claims) && data.claims >= 0
    && (data.healthScore === null || (Number.isInteger(data.healthScore) && data.healthScore >= 0 && data.healthScore <= 100))
    && Array.isArray(data.statusCounts) && data.statusCounts.every((row) => row
      && typeof row.status === 'string' && Number.isSafeInteger(row.count) && row.count >= 0)
    && Array.isArray(data.recentEvents) && data.recentEvents.length <= 10
    && data.recentEvents.every((event) => event && typeof event.type === 'string'
      && typeof event.message === 'string' && typeof event.time === 'string'
      && Number.isFinite(Date.parse(event.time)));
}

export default function SummaryPanel() {
  const state = useDashboardResource(getSummary, isSummary);
  const summary = state.data;

  if (state.loading) {
    return <p aria-live="polite">Loading operations summary…</p>;
  }

  if (state.error) {
    return (
      <section
        role="alert"
        style={{ border: '1px solid #6f2f2f', borderRadius: 10, padding: 18, background: '#241515' }}
      >
        <h2 style={{ marginTop: 0 }}>Operations Summary</h2>
        <p>{state.error}</p>
        <button type="button" onClick={state.refresh}>Try again</button>
      </section>
    );
  }

  if (!summary) {
    return <p>No operations summary is available.</p>;
  }

  return (
    <section
      aria-labelledby="operations-summary-title"
      style={{ border: '1px solid #303030', borderRadius: 10, padding: 18, background: '#171717' }}
    >
      <h2 id="operations-summary-title" style={{ margin: 0 }}>Operations Summary</h2>
      <p style={{ color: '#aaa', marginTop: 6 }}>
        Current restaurant, outreach, claim, health, and status totals.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <div style={{ borderRadius: 8, padding: 12, background: '#222' }}>
          <p style={{ color: '#aaa', margin: 0 }}>Restaurants</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0' }}>{summary.totalRestaurants.toLocaleString()}</p>
        </div>
        <div style={{ borderRadius: 8, padding: 12, background: '#222' }}>
          <p style={{ color: '#aaa', margin: 0 }}>Outreach sent</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0' }}>{summary.outreachSent.toLocaleString()}</p>
        </div>
        <div style={{ borderRadius: 8, padding: 12, background: '#222' }}>
          <p style={{ color: '#aaa', margin: 0 }}>Claims</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0' }}>{summary.claims.toLocaleString()}</p>
        </div>
        <div style={{ borderRadius: 8, padding: 12, background: '#222' }}>
          <p style={{ color: '#aaa', margin: 0 }}>Health score</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '6px 0 0' }}>
            {summary.healthScore == null ? 'No data' : `${summary.healthScore}/100`}
          </p>
        </div>
      </div>
      <div style={{ marginTop: 18 }}>
        <h3>Current Status Counts</h3>
        {!summary.statusCounts.length ? <p>No records found.</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {summary.statusCounts.map((row) => (
              <li key={row.status} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0' }}>
                <span>{row.status.replaceAll('_', ' ')}</span>
                <strong>{row.count.toLocaleString()}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ marginTop: 18 }}>
        <h3>Recent Events</h3>
        {!summary.recentEvents.length ? <p>No events recorded yet.</p> : (
          <ul style={{ maxHeight: 220, overflowY: 'auto', paddingLeft: 20 }}>
            {[...summary.recentEvents].reverse().map((event, index) => (
              <li key={`${event.time}-${index}`} style={{ marginBottom: 10 }}>
                <span className="font-semibold">{event.type.toUpperCase()}</span> — {event.message}
                <time style={{ display: 'block', color: '#aaa', fontSize: 12 }} dateTime={event.time}>
                  {new Date(event.time).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}