import { useEffect, useState } from 'react';
import { Bot, Coins, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ModelUsage {
  calls: number;
  totalTokens: number;
  estimatedCost: number;
}

interface AiUsageResponse {
  success: boolean;
  dailyCalls: number;
  monthlyCalls: number;
  totalTokens: number;
  estimatedCost: number;
  currency: 'GBP';
  estimate: boolean;
  modelBreakdown: Record<string, number>;
  modelDetails: Record<string, ModelUsage>;
  lastUpdated: string | null;
  error?: string;
}

function formatCost(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
  }).format(value);
}

export function AiUsage() {
  const [usage, setUsage] = useState<AiUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetch('/dashboard/ai-usage', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as AiUsageResponse;
        if (!result.success) {
          window.location.assign('/admin/login');
          return null;
        }
        return result;
      })
      .then((result) => {
        if (result) setUsage(result);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error ? failure.message : 'AI usage could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  const models = Object.entries(usage?.modelDetails ?? {});

  return (
    <Card id="aiUsage" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Bot className="h-5 w-5 text-primary" />
            AI Usage &amp; Cost
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            OpenAI token usage recorded from successful API responses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh AI usage"
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
                <p className="text-xs text-muted-foreground">Calls today</p>
                <p className="mt-1 text-2xl font-bold">{usage?.dailyCalls.toLocaleString() ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Calls this month</p>
                <p className="mt-1 text-2xl font-bold">{usage?.monthlyCalls.toLocaleString() ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Total tokens</p>
                <p className="mt-1 text-2xl font-bold">{usage?.totalTokens.toLocaleString() ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" /> Estimated cost
                </p>
                <p className="mt-1 text-2xl font-bold">
                  {usage ? formatCost(usage.estimatedCost) : '—'}
                </p>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">Model breakdown</h3>
              {models.length ? (
                <div className="overflow-hidden rounded-xl border border-border">
                  {models.map(([model, values]) => (
                    <div
                      key={model}
                      className="grid gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:grid-cols-4"
                    >
                      <p className="font-mono text-sm font-semibold">{model}</p>
                      <p className="text-sm text-muted-foreground">{values.calls.toLocaleString()} calls</p>
                      <p className="text-sm text-muted-foreground">{values.totalTokens.toLocaleString()} tokens</p>
                      <p className="text-sm font-semibold sm:text-right">
                        {formatCost(values.estimatedCost)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                  No AI usage has been recorded yet.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Costs are estimates based on standard OpenAI token pricing and exclude other fees.
              Last updated:{' '}
              {usage?.lastUpdated
                ? new Date(usage.lastUpdated).toLocaleString()
                : 'No usage recorded'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}