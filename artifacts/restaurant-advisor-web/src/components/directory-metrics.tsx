import { getDirectoryMetrics, type DirectoryMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isDirectoryMetrics(value: unknown): value is DirectoryMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<DirectoryMetricsResponse>;
  return metrics.success === true && typeof metrics.loads === 'number';
}

export function DirectoryMetrics() {
  const state = useDashboardResource(getDirectoryMetrics, isDirectoryMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Directory Metrics"
      description="Anonymous directory page-batch activity from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Directory loads', metrics.loads],
            ['Last 24 hours', metrics.loadsToday],
            ['Deeper-page loads', metrics.deeperPageLoads],
            ['Filtered loads', metrics.filteredLoads],
            ['Premium-only loads', metrics.premiumOnlyLoads],
            ['Average results', metrics.averageResults],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</p>
            </div>
          ))}
        </div>
      ) : null}
    </DashboardPanel>
  );
}