import { getSearchMetrics, type SearchMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isSearchMetrics(value: unknown): value is SearchMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<SearchMetricsResponse>;
  return metrics.success === true && typeof metrics.searches === 'number';
}

export function SearchEngineMetrics() {
  const state = useDashboardResource(getSearchMetrics, isSearchMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Search Engine Metrics"
      description="Aggregated search activity from the last seven days; raw search text and user identifiers are not stored."
      {...state}
    >
      {metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Searches', metrics.searches.toLocaleString()],
            ['Last 24 hours', metrics.searchesToday.toLocaleString()],
            ['Zero-result rate', `${metrics.zeroResultRate}%`],
            ['AI searches', metrics.aiSearches.toLocaleString()],
            ['AI-scored restaurants', metrics.aiScoredRestaurants.toLocaleString()],
            ['Average results', metrics.averageResults.toLocaleString()],
            ['Average response', `${metrics.averageDurationMs} ms`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </DashboardPanel>
  );
}