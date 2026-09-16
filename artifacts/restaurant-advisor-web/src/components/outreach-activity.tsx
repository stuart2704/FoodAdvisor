import { useEffect, useState } from 'react';
import { Mail, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface OutreachItem {
  id: number;
  restaurant: string;
  email: string | null;
  recipientDomain: string | null;
  subject: string | null;
  sentAt: string;
  aiSummary: string | null;
}

interface OutreachRecords {
  success: boolean;
  total: number;
  items: OutreachItem[];
  error?: string;
}

interface OutreachSummary {
  success: boolean;
  totalEvents: number;
  sent: number;
  failed: number;
  error?: string;
}

export function OutreachActivity() {
  const [records, setRecords] = useState<OutreachRecords | null>(null);
  const [summary, setSummary] = useState<OutreachSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const options: RequestInit = {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    };
    setLoading(true);
    setError(null);

    void Promise.all([
      fetch('/dashboard/outreach?page=1&limit=50', options),
      fetch('/dashboard/outreach/summary', options),
    ])
      .then(async ([recordsResponse, summaryResponse]) => {
        const recordsResult = (await recordsResponse.json()) as OutreachRecords;
        const summaryResult = (await summaryResponse.json()) as OutreachSummary;
        if (!recordsResult.success || !summaryResult.success) {
          window.location.assign('/admin/login');
          return null;
        }
        return { recordsResult, summaryResult };
      })
      .then((result) => {
        if (!result) return;
        setRecords(result.recordsResult);
        setSummary(result.summaryResult);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Outreach activity could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="outreach" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Mail className="h-5 w-5 text-primary" />
            Outreach Activity
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Recent confirmed sends and delivery activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh outreach activity"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-secondary/50 p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Send className="h-3.5 w-3.5" /> Confirmed sends
            </p>
            <p className="mt-1 text-2xl font-bold">{summary?.sent.toLocaleString() ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-secondary/50 p-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="h-3.5 w-3.5" /> Failed sends
            </p>
            <p className="mt-1 text-2xl font-bold">{summary?.failed.toLocaleString() ?? '—'}</p>
          </div>
          <div className="rounded-xl bg-secondary/50 p-4">
            <p className="text-xs text-muted-foreground">All audit events</p>
            <p className="mt-1 text-2xl font-bold">
              {summary?.totalEvents.toLocaleString() ?? '—'}
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>AI summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !records ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Loading outreach activity…
                    </TableCell>
                  </TableRow>
                ) : records?.items.length ? (
                  records.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold">{item.restaurant}</TableCell>
                      <TableCell>{item.email ?? item.recipientDomain ?? '—'}</TableCell>
                      <TableCell>{new Date(item.sentAt).toLocaleString()}</TableCell>
                      <TableCell>{item.subject ?? 'Not stored'}</TableCell>
                      <TableCell>{item.aiSummary ?? 'Not stored'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No confirmed outreach sends yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        {records ? (
          <p className="text-xs text-muted-foreground">
            Showing up to 50 of {records.total.toLocaleString()} confirmed sends.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}