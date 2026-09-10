import type { GetDashboardSummary200 } from '@workspace/api-client-react';
import { getSummary } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isSummary(value: unknown): value is GetDashboardSummary200 {
  if (!value || typeof value !== 'object') return false;
  const data = value as GetDashboardSummary200;
  return (data.healthScore === null || (Number.isInteger(data.healthScore) && data.healthScore >= 0 && data.healthScore <= 100))
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
  return (
    <DashboardPanel title="Operations Summary" description="Today's health score (UTC), current status totals, and recent process-local events." {...state}>
      <div className="mb-5">
        <h3 className="text-sm font-semibold">Health Score</h3>
        <p className="text-3xl font-bold">{summary?.healthScore == null ? 'No data' : `${summary.healthScore}/100`}</p>
      </div>
      <div className="mb-5">
        <h3 className="mb-2 text-sm font-semibold">Current Status Counts</h3>
        {!summary?.statusCounts.length ? <p className="text-sm text-muted-foreground">No records found.</p> : (
          <ul className="space-y-1 text-sm">
            {summary.statusCounts.map((row) => (
              <li key={row.status} className="flex justify-between gap-4">
                <span className="break-words">{row.status.replaceAll('_', ' ')}</span>
                <span className="font-semibold tabular-nums">{row.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Recent Events</h3>
        {!summary?.recentEvents.length ? <p className="text-sm text-muted-foreground">No events recorded yet.</p> : (
          <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
            {[...summary.recentEvents].reverse().map((event, index) => (
              <li key={`${event.time}-${index}`} className="break-words">
                <span className="font-semibold">{event.type.toUpperCase()}</span> — {event.message}
                <time className="block text-xs text-muted-foreground" dateTime={event.time}>
                  {new Date(event.time).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardPanel>
  );
}