import { getClaimPageMetrics, type ClaimPageMetricsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isClaimPageMetrics(value: unknown): value is ClaimPageMetricsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<ClaimPageMetricsResponse>;
  return metrics.success === true && typeof metrics.views === 'number';
}

export function ClaimPageMetrics() {
  const state = useDashboardResource(getClaimPageMetrics, isClaimPageMetrics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Claim Page Metrics"
      description="Anonymous valid claim-link activity from the last seven days."
      {...state}
    >
      {metrics ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['Claim-page views', metrics.views],
            ['Last 24 hours', metrics.viewsToday],
            ['Completed claims', metrics.completedClaims],
            ['Already claimed', metrics.alreadyClaimedViews],
            ['Conversion rate', `${metrics.conversionRate}%`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </DashboardPanel>
  );
}