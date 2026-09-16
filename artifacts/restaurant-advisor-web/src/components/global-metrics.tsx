import { useEffect, useState } from 'react';
import { Building2, Globe2, MapPin, RefreshCw, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface GlobalMetricsResponse {
  success: boolean;
  totalRestaurants: number;
  countries: number;
  cities: number;
  newToday: number;
  newThisWeek: number;
  newThisMonth: number;
  topCountries: Record<string, number>;
  topCities: Record<string, number>;
  lastUpdated: string | null;
  error?: string;
}

export function GlobalMetrics() {
  const [metrics, setMetrics] = useState<GlobalMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetch('/dashboard/global', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as GlobalMetricsResponse;
        if (!result.success) {
          window.location.assign('/admin/login');
          return null;
        }
        return result;
      })
      .then((result) => {
        if (result) setMetrics(result);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Global restaurant metrics could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="global" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Globe2 className="h-5 w-5 text-primary" />
            Global Restaurant Metrics
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Restaurant coverage and import growth by location.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh global restaurant metrics"
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> Restaurants
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {metrics?.totalRestaurants.toLocaleString() ?? '—'}
                </p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Globe2 className="h-3.5 w-3.5" /> Countries
                </p>
                <p className="mt-1 text-2xl font-bold">{metrics?.countries ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" /> Cities
                </p>
                <p className="mt-1 text-2xl font-bold">{metrics?.cities ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5" /> New today
                </p>
                <p className="mt-1 text-2xl font-bold">{metrics?.newToday ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">New this week</p>
                <p className="mt-1 text-2xl font-bold">{metrics?.newThisWeek ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">New this month</p>
                <p className="mt-1 text-2xl font-bold">{metrics?.newThisMonth ?? '—'}</p>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {[
                ['Top countries', metrics?.topCountries ?? {}],
                ['Top cities', metrics?.topCities ?? {}],
              ].map(([title, values]) => {
                const entries = Object.entries(values as Record<string, number>);
                return (
                  <div key={title as string}>
                    <h3 className="mb-3 text-sm font-semibold">{title as string}</h3>
                    {entries.length ? (
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {entries.map(([location, count]) => (
                          <li key={location} className="flex justify-between px-4 py-3 text-sm">
                            <span>{location}</span>
                            <strong>{count.toLocaleString()}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                        No location data.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Last updated:{' '}
              {metrics?.lastUpdated
                ? new Date(metrics.lastUpdated).toLocaleString()
                : 'No restaurants imported'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}