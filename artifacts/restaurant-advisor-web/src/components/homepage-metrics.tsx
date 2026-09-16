import { getHomepageMetrics, type HomepageMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isHomepageMetrics(value: unknown): value is HomepageMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<HomepageMetricsResponse>;
  return metrics.success === true && typeof metrics.loads === 'number';
}

export function HomepageMetrics() {
  const state = useDashboardResource(getHomepageMetrics, isHomepageMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Homepage Metrics"
      description="Anonymous homepage activity and average section sizes from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Homepage loads', metrics.loads],
            ['Last 24 hours', metrics.loadsToday],
            ['Average featured', metrics.averageFeatured],
            ['Average trending', metrics.averageTrending],
            ['Average Premium', metrics.averagePremium],
            ['Average discovery', metrics.averageDiscovery],
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