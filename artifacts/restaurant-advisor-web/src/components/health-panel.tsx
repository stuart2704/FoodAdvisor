import type { DashboardHealth } from '@workspace/api-client-react';
import { getHealth } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isHealth(value: unknown): value is DashboardHealth {
  if (!value || typeof value !== 'object') return false;
  const item = value as DashboardHealth;
  return (item.score === null || (Number.isInteger(item.score) && item.score >= 0 && item.score <= 100))
    && Array.isArray(item.recent) && item.recent.length <= 20 && item.recent.every((record) =>
      record && typeof record.city === 'string' && typeof record.mapsSuccess === 'boolean'
      && (record.websiteSuccess === null || typeof record.websiteSuccess === 'boolean')
      && typeof record.durationMs === 'number' && Number.isFinite(record.durationMs) && record.durationMs >= 0
      && typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)));
}

export default function HealthPanel() {
  const state = useDashboardResource(getHealth, isHealth);
  return (
    <DashboardPanel title="Scraper Health" description="Last ten samples today (UTC). History resets on server restart." {...state}>
      <p className="mb-4 text-3xl font-bold">
        {state.data?.score == null ? 'No data' : `${state.data.score}/100`}
      </p>
      {!state.data?.recent.length ? <p className="text-sm text-muted-foreground">No scraper health records yet.</p> : (
        <div className="max-h-64 space-y-3 overflow-y-auto">
          {[...state.data.recent].reverse().map((record, index) => (
            <div key={`${record.timestamp}-${record.city}-${index}`} className="border-b pb-3 text-sm">
              <p className="font-semibold">{record.city}</p>
              <p>Maps: {record.mapsSuccess ? 'OK' : 'Failed'}</p>
              <p>Website: {record.websiteSuccess === null ? 'Not attempted' : record.websiteSuccess ? 'OK' : 'Failed'}</p>
              <p>Duration: {record.durationMs.toLocaleString()} ms</p>
              <time className="text-xs text-muted-foreground" dateTime={record.timestamp}>
                {new Date(record.timestamp).toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      )}
    </DashboardPanel>
  );
}