import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface QualifiedLead {
  placeId: string;
  name: string;
  city: string;
  score: number;
  tier: 'A' | 'B' | 'C' | 'D';
  reason: string;
  qualifiedAt: string;
}

interface LeadQualificationResponse {
  success: boolean;
  qualified: number;
  unqualified: number;
  averageScore: number;
  byTier: Record<'A' | 'B' | 'C' | 'D', number>;
  items: QualifiedLead[];
  mode: 'review';
  error?: string;
}

export function LeadQualification() {
  const [data, setData] = useState<LeadQualificationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetch('/dashboard/lead-qualification', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as LeadQualificationResponse;
        if (!result.success) {
          if (response.status === 401) {
            window.location.assign('/admin/login');
            return null;
          }
          throw new Error(result.error ?? 'Lead qualification could not be loaded.');
        }
        return result;
      })
      .then((result) => {
        if (result) setData(result);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Lead qualification could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="leadQual" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="h-5 w-5 text-primary" />
            Lead Qualification
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            AI recommendations are stored for review and do not trigger outreach automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh lead qualification"
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
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Qualified</p>
                <p className="mt-1 text-2xl font-bold">{data?.qualified ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Awaiting qualification</p>
                <p className="mt-1 text-2xl font-bold">{data?.unqualified ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Average score</p>
                <p className="mt-1 text-2xl font-bold">
                  {data ? data.averageScore.toFixed(1) : '—'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(['A', 'B', 'C', 'D'] as const).map((tier) => (
                <span
                  key={tier}
                  className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold"
                >
                  Tier {tier}: {data?.byTier[tier] ?? 0}
                </span>
              ))}
            </div>

            {data?.items.length ? (
              <div className="divide-y divide-border rounded-xl border border-border">
                {data.items.map((item) => (
                  <div key={item.placeId} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{item.name}</strong>
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                        Score {item.score}
                      </span>
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">
                        Tier {item.tier}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{item.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No restaurants have been qualified yet.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}