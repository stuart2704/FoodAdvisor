import { useEffect, useState } from 'react';
import { MailCheck, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface FollowUpItem {
  restaurant: string;
  placeId: string;
  attempt: 2 | 3;
  subject: string | null;
  sentAt: string;
}

interface FollowUpResponse {
  success: boolean;
  items: FollowUpItem[];
  error?: string;
}

export function FollowUpActivity() {
  const [items, setItems] = useState<FollowUpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch('/dashboard/followups', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as FollowUpResponse;
        if (response.status === 401) {
          window.location.assign('/admin/login');
          return null;
        }
        if (!response.ok || !data.success) {
          throw new Error(data.error ?? 'Follow-up activity could not be loaded.');
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
              : 'Follow-up activity could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="followups" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheck className="h-5 w-5 text-primary" />
            Follow-Up Activity
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Provider-confirmed follow-up deliveries. Queued campaigns are excluded.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh follow-up activity"
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
              <div key={`${item.placeId}-${item.attempt}`} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{item.restaurant}</strong>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold">
                    Attempt {item.attempt}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  Subject: {item.subject ?? 'Subject unavailable for an earlier delivery'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sent {new Date(item.sentAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No confirmed follow-up deliveries yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}