import { Crown } from 'lucide-react';
import { getRankingMetrics, type RankingMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isRankingMetrics(value: unknown): value is RankingMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<RankingMetricsResponse>;
  return (
    metrics.success === true &&
    typeof metrics.rankedRestaurants === 'number' &&
    Array.isArray(metrics.topRestaurants)
  );
}

export function RankingEngine() {
  const state = useDashboardResource(getRankingMetrics, isRankingMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Ranking Engine"
      description="Stored ranking scores are recalculated daily at 03:00 server time."
      {...state}
    >
      {metrics ? (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>
              Last update:{' '}
              {metrics.lastUpdate
                ? new Date(metrics.lastUpdate).toLocaleString('en-GB')
                : 'Not run yet'}
            </span>
            <span>
              Premium boost active: {metrics.premiumBoostActive ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Ranked</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.rankedRestaurants.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Premium average</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.averagePremiumScore}</p>
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Basic average</p>
              <p className="mt-2 text-2xl font-semibold">{metrics.averageBasicScore}</p>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Top-ranked restaurants</h3>
            {metrics.topRestaurants.length ? (
              <div className="divide-y divide-border">
                {metrics.topRestaurants.map((restaurant) => (
                  <div key={restaurant.placeId} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <p className="flex items-center gap-2 font-medium">
                        {restaurant.name}
                        {restaurant.premium && <Crown className="h-3.5 w-3.5 text-primary" />}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {restaurant.cuisine ?? 'Unclassified'} · {restaurant.city}
                      </p>
                    </div>
                    <span className="font-mono text-sm">{restaurant.rankingScore.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Rankings have not been calculated yet.</p>
            )}
          </div>
        </div>
      ) : null}
    </DashboardPanel>
  );
}