import { getCityMetrics, type CityMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isCityMetrics(value: unknown): value is CityMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<CityMetricsResponse>;
  return (
    metrics.success === true &&
    typeof metrics.views === 'number' &&
    Array.isArray(metrics.topCities)
  );
}

export function CityPageMetrics() {
  const state = useDashboardResource(getCityMetrics, isCityMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="City Page Metrics"
      description="Anonymous city-page activity from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['City-page views', metrics.views],
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
            <h3 className="mb-2 text-sm font-semibold">Most viewed cities</h3>
            {metrics.topCities.length ? (
              <div className="divide-y divide-border">
                {metrics.topCities.map((item) => (
                  <div key={item.city} className="flex justify-between py-2 text-sm">
                    <span>{item.city}</span>
                    <span className="font-medium">{item.views.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No city-page views recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </DashboardPanel>
  );
}