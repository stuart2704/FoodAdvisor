import { getCuisineMetrics, type CuisineMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isCuisineMetrics(value: unknown): value is CuisineMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<CuisineMetricsResponse>;
  return (
    metrics.success === true &&
    typeof metrics.views === 'number' &&
    Array.isArray(metrics.topCuisines)
  );
}

export function CuisinePageMetrics() {
  const state = useDashboardResource(getCuisineMetrics, isCuisineMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Cuisine Page Metrics"
      description="Anonymous cuisine-page activity from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['Cuisine-page views', metrics.views],
              ['Last 24 hours', metrics.viewsToday],
              ['Average restaurants', metrics.averageRestaurants],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Most viewed cuisines</h3>
            {metrics.topCuisines.length ? (
              <div className="divide-y divide-border">
                {metrics.topCuisines.map((item) => (
                  <div key={item.cuisine} className="flex justify-between py-2 text-sm">
                    <span>{item.cuisine}</span>
                    <span className="font-medium">{item.views.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No cuisine-page views recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </DashboardPanel>
  );
}