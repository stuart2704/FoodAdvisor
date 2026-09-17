import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, BarChart3, Crown, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PortalResponse {
  success: boolean;
  restaurant?: { name: string; premium: boolean };
}

interface InsightResponse {
  success: boolean;
  analytics?: {
    profileViews: number;
    menuViews: number;
    photoViews: number;
    searchImpressions: number;
    clicks: number;
    claimClicks: number;
    premiumConversions: number;
    bookings: number;
    reviews: number;
  };
  insight?: { summary: string; nextAction: string };
  error?: string;
}

export default function PortalAnalyticsPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [portal, setPortal] = useState<PortalResponse | null>(null);
  const [insight, setInsight] = useState<InsightResponse['insight']>();
  const [insightError, setInsightError] = useState('');
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [analytics, setAnalytics] = useState<InsightResponse['analytics']>();

  async function loadInsight() {
    setLoadingInsight(true);
    setInsightError('');
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(token)}/analytics-insight`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
        },
      );
      const result = (await response.json()) as InsightResponse;
      if (!response.ok || !result.success || !result.insight) {
        throw new Error(result.error || 'Your analytics insight is unavailable.');
      }
      setInsight(result.insight);
      setAnalytics(result.analytics);
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : 'Your analytics insight is unavailable.');
    } finally {
      setLoadingInsight(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/portal/${encodeURIComponent(token)}`, {
        signal: controller.signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
      fetch(`/api/portal/${encodeURIComponent(token)}/analytics`, {
        signal: controller.signal,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      }),
    ])
      .then(async ([portalResponse, analyticsResponse]) => {
        if (!portalResponse.ok || !analyticsResponse.ok) throw new Error();
        const portalPayload = (await portalResponse.json()) as PortalResponse;
        const analyticsPayload = (await analyticsResponse.json()) as InsightResponse;
        setPortal(portalPayload);
        setAnalytics(analyticsPayload.analytics);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setPortal({ success: false });
        }
      });
    return () => controller.abort();
  }, [token]);

  if (!portal) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!portal.success || !portal.restaurant) {
    return <div className="flex min-h-screen items-center justify-center p-6">Invalid or expired login link.</div>;
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-3xl">
        <Link href={`/portal/${token}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to portal
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" /> Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {analytics && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ['Profile views', analytics.profileViews],
                  ['Bookings', analytics.bookings],
                  ['Reviews', analytics.reviews],
                  ['Search impressions', analytics.searchImpressions],
                  ['Clicks', analytics.clicks],
                  ['Menu views', analytics.menuViews],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border p-4">
                    <p className="text-2xl font-semibold">{value}</p>
                    <p className="text-sm text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-border bg-secondary/30 p-4">
              <div className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> AI analytics insight
              </div>
              {insight ? (
                <div className="mt-3 space-y-3 text-sm">
                  <p>{insight.summary}</p>
                  <p><strong>Next action:</strong> {insight.nextAction}</p>
                </div>
              ) : (
                <Button className="mt-3" onClick={loadInsight} disabled={loadingInsight}>
                  {loadingInsight ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Generate insight
                </Button>
              )}
              {insightError ? <p role="alert" className="mt-3 text-sm text-destructive">{insightError}</p> : null}
            </div>
            {!portal.restaurant.premium ? (
              <>
                <p className="text-muted-foreground">
                  Analytics are a Premium feature. Your Basic listing remains active.
                </p>
                <Button asChild>
                  <Link href={`/portal/${token}/upgrade`}>
                    <Crown className="mr-2 h-4 w-4" /> View Premium Options
                  </Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                Analytics are included with Premium, but verified reporting data is not available yet.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}