import { useEffect, useState } from 'react';
import { Flame, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface EscalationItem {
  placeId: string;
  restaurant: string;
  leadStatus: 'WARM' | 'HOT' | 'CLIENT';
  lastReply: null;
  escalatedAt: string | null;
  claimClickedAt: string | null;
  onboardedAt: string | null;
}

interface EscalationResponse {
  success: boolean;
  items: EscalationItem[];
  error?: string;
}

function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

export function LeadEscalation() {
  const [items, setItems] = useState<EscalationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch('/dashboard/escalation', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as EscalationResponse;
        if (response.status === 401) {
          window.location.assign('/admin/login');
          return null;
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? 'Lead escalation could not be loaded.');
        }
        return data;
      })
      .then((data) => {
        if (data) setItems(data.items);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Lead escalation could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="escalation" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Flame className="h-5 w-5 text-primary" />
            Lead Escalation
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Positive replies, verified claim activity, and completed onboarding.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh lead escalation"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : items.length ? (
          <div className="divide-y divide-border rounded-xl border border-border">
            {items.map((item) => (
              <div key={item.placeId} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{item.restaurant}</strong>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                    {item.leadStatus}
                  </span>
                </div>
                <dl className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                  <div>Escalated: {timestamp(item.escalatedAt)}</div>
                  <div>Claim clicked: {timestamp(item.claimClickedAt)}</div>
                  <div>Onboarded: {timestamp(item.onboardedAt)}</div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reply bodies are not retained in dashboard storage.
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No escalated leads yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}