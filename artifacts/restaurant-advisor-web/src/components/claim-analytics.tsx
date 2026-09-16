import { useEffect, useState } from 'react';
import { BadgeCheck, MousePointerClick, RefreshCw, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ClaimEvent {
  restaurant: string;
  type: 'visit' | 'click' | 'completed';
  occurredAt: string | null;
}

interface ClaimsResponse {
  success: boolean;
  visits: number;
  clicks: number;
  completed: number;
  conversionRate: number;
  byCountry: Record<string, number>;
  recent: ClaimEvent[];
  trackingNote: string;
  error?: string;
}

export function ClaimAnalytics() {
  const [claims, setClaims] = useState<ClaimsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetch('/dashboard/claims', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as ClaimsResponse;
        if (!result.success) {
          window.location.assign('/admin/login');
          return null;
        }
        return result;
      })
      .then((result) => {
        if (result) setClaims(result);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Claim analytics could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="claims" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <BadgeCheck className="h-5 w-5 text-primary" />
            Claim‑Page Analytics
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified restaurant claim activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh claim analytics"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Visits
                </p>
                <p className="mt-1 text-2xl font-bold">{claims?.visits ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MousePointerClick className="h-3.5 w-3.5" /> Clicks
                </p>
                <p className="mt-1 text-2xl font-bold">{claims?.clicks ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Completed claims</p>
                <p className="mt-1 text-2xl font-bold">{claims?.completed ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Conversion rate</p>
                <p className="mt-1 text-2xl font-bold">
                  {claims ? `${claims.conversionRate.toFixed(1)}%` : '—'}
                </p>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
              <div>
                <h3 className="mb-3 text-sm font-semibold">Completed by country</h3>
                {Object.keys(claims?.byCountry ?? {}).length ? (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {Object.entries(claims?.byCountry ?? {}).map(([country, count]) => (
                      <li key={country} className="flex justify-between px-4 py-3 text-sm">
                        <span>{country}</span>
                        <strong>{count.toLocaleString()}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                    No completed claims yet.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold">Recent claim activity</h3>
                {claims?.recent.length ? (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {claims.recent.map((event, index) => (
                      <li
                        key={`${event.restaurant}-${event.occurredAt ?? index}`}
                        className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <span className="text-sm font-semibold">{event.restaurant}</span>
                        <span className="text-xs text-muted-foreground">
                          {event.type} ·{' '}
                          {event.occurredAt
                            ? new Date(event.occurredAt).toLocaleString()
                            : 'Time unavailable'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                    No recent claim activity.
                  </p>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{claims?.trackingNote}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}