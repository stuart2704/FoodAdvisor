import { getGlobalAnalytics, type GlobalAnalyticsResponse } from '@/lib/dashboard-api';
import { useDashboardResource } from '@/hooks/use-dashboard-resource';
import { DashboardPanel } from './dashboard-panel';

function isGlobalAnalytics(value: unknown): value is GlobalAnalyticsResponse {
  if (!value || typeof value !== 'object') return false;
  const metrics = value as Partial<GlobalAnalyticsResponse>;
  return (
    metrics.success === true &&
    typeof metrics.totalRestaurants === 'number' &&
    typeof metrics.totalClicks === 'number'
  );
}

export function GlobalAnalytics() {
  const state = useDashboardResource(getGlobalAnalytics, isGlobalAnalytics);
  const metrics = state.data;
  return (
    <DashboardPanel
      title="Global Metrics"
      description="Current platform totals calculated from restaurants and immutable analytics events."
      {...state}
    >
      {metrics ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['Total restaurants', metrics.totalRestaurants],
              ['Total claimed', metrics.totalClaimed],
              ['Premium clients', metrics.totalPremium],
              ['Total visits', metrics.totalVisits],
              ['Total clicks', metrics.totalClicks],
              ['Search impressions', metrics.totalSearchImpressions],
              ['Claim conversions', metrics.totalClaimConversions],
              ['Onboarding completions', metrics.totalOnboardingCompletions],
              ['Premium conversions', metrics.totalPremiumConversions],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold">Conversion funnel</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Outreach', metrics.funnelOutreach],
                ['Follow-up', metrics.funnelFollowUp],
                ['Escalation', metrics.funnelEscalation],
                ['Claim', metrics.funnelClaim],
                ['Onboarding', metrics.funnelOnboarding],
                ['Portal login', metrics.funnelPortalLogin],
                ['Premium', metrics.funnelPremium],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-secondary/50 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold">{Number(value).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['MRR', `£${metrics.mrr.toLocaleString()}`],
              ['ARR', `£${metrics.arr.toLocaleString()}`],
              ['Churn rate', `${metrics.churnRate}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {[
              ['Top cities', metrics.topCities],
              ['Top cuisines', metrics.topCuisines],
            ].map(([title, values]) => (
              <div key={title as string}>
                <h3 className="mb-2 text-sm font-semibold">{title as string}</h3>
                <div className="divide-y divide-border">
                  {Object.entries(values as Record<string, number>).map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2 text-sm">
                      <span>{label}</span>
                      <span className="font-medium">{value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Last updated: {new Date(metrics.updatedAt).toLocaleString()}
          </p>
        </div>
      ) : null}
    </DashboardPanel>
  );
}