import { getProfileMetrics, type ProfileMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isProfileMetrics(value: unknown): value is ProfileMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<ProfileMetricsResponse>;
  return (
    metrics.success === true &&
    typeof metrics.views === 'number' &&
    Array.isArray(metrics.topRestaurants)
  );
}

export function RestaurantProfileMetrics() {
  const state = useDashboardResource(getProfileMetrics, isProfileMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Restaurant Profile Metrics"
      description="Anonymous restaurant-profile activity from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Profile views', metrics.views],
              ['Last 24 hours', metrics.viewsToday],
              ['Premium views', metrics.premiumViews],
              ['Unclaimed views', metrics.unclaimedViews],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Most viewed restaurants</h3>
            {metrics.topRestaurants.length ? (
              <div className="divide-y divide-border">
                {metrics.topRestaurants.map((item) => (
                  <div key={item.placeId} className="flex justify-between gap-4 py-2 text-sm">
                    <span>{item.name} <span className="text-muted-foreground">· {item.city}</span></span>
                    <span className="font-medium">{item.views.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No profile views recorded yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </DashboardPanel>
  );
}