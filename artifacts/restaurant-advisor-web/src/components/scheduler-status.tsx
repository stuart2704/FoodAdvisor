import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Scheduler {
  name: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  running: boolean;
  nextRunAt: string | null;
}

interface SchedulerStatusResponse {
  success: boolean;
  lastRun: string | null;
  nextRun: string | null;
  processed: number;
  aiCalls: number;
  emailsSent: number;
  errors: string[];
  scope: string;
  metricsNote: string;
  deploymentNote: string;
  schedulers: Scheduler[];
}

interface SchedulerRun {
  id: number;
  scheduler: string;
  startedAt: string;
  completedAt: string;
  outcome: 'completed' | 'failed' | 'skipped';
  message: string;
}

interface SchedulerHistoryResponse {
  success: boolean;
  scope: string;
  resetsOnRestart: boolean;
  total: number;
  items: SchedulerRun[];
}

function schedulerLabel(name: string) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function SchedulerStatus() {
  const [status, setStatus] = useState<SchedulerStatusResponse | null>(null);
  const [history, setHistory] = useState<SchedulerHistoryResponse | null>(null);
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
      fetch('/dashboard/scheduler', options),
      fetch('/dashboard/scheduler/history?limit=50', options),
    ])
      .then(async ([statusResponse, historyResponse]) => {
        const statusResult = (await statusResponse.json()) as SchedulerStatusResponse;
        const historyResult = (await historyResponse.json()) as SchedulerHistoryResponse;
        if (!statusResult.success || !historyResult.success) {
          window.location.assign('/admin/login');
          return null;
        }
        return { statusResult, historyResult };
      })
      .then((result) => {
        if (!result) return;
        setStatus(result.statusResult);
        setHistory(result.historyResult);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Scheduler status could not be loaded.',
          );
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [revision]);

  return (
    <Card id="scheduler" className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CalendarClock className="h-5 w-5 text-primary" />
            Scheduler Status
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Gmail watch automation running in the current API process.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh scheduler status"
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Last run</p>
                <p className="mt-1 text-sm font-semibold">
                  {status?.lastRun ? new Date(status.lastRun).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Next run</p>
                <p className="mt-1 text-sm font-semibold">
                  {status?.nextRun ? new Date(status.nextRun).toLocaleString() : 'Not scheduled'}
                </p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Restaurants processed</p>
                <p className="mt-1 text-2xl font-bold">{status?.processed ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">AI calls</p>
                <p className="mt-1 text-2xl font-bold">{status?.aiCalls ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-secondary/50 p-4">
                <p className="text-xs text-muted-foreground">Emails sent</p>
                <p className="mt-1 text-2xl font-bold">{status?.emailsSent ?? '—'}</p>
              </div>
            </div>

            {status?.errors.length ? (
              <div className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <p className="font-semibold">Errors</p>
                <ul className="mt-1 list-disc pl-5">
                  {status.errors.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Errors: None</p>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {status?.schedulers.map((scheduler) => (
                <div key={scheduler.name} className="rounded-2xl border border-border bg-background p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">{schedulerLabel(scheduler.name)}</h3>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {scheduler.schedule} · {scheduler.timezone}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        scheduler.enabled
                          ? 'bg-primary/10 text-primary'
                          : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      {scheduler.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-sm">
                    {scheduler.running ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    {scheduler.running ? 'Scheduled in this process' : 'Not scheduled in this process'}
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="h-4 w-4" />
                    Next run:{' '}
                    {scheduler.nextRunAt
                      ? new Date(scheduler.nextRunAt).toLocaleString()
                      : 'Not available'}
                  </p>
                </div>
              ))}
              {loading && !status ? (
                <p className="text-sm text-muted-foreground">Loading scheduler status…</p>
              ) : null}
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold">Recent run history</h3>
              {history?.items.length ? (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {history.items.map((run) => (
                    <li key={run.id} className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{schedulerLabel(run.scheduler)}</p>
                        <p className="text-xs text-muted-foreground">{run.message}</p>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-sm capitalize">{run.outcome}</p>
                        <time className="text-xs text-muted-foreground" dateTime={run.completedAt}>
                          {new Date(run.completedAt).toLocaleString()}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                  No scheduler runs have been recorded in this process.
                </p>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {status?.metricsNote} {status?.deploymentNote} Run history is process-local and resets when the API restarts.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}