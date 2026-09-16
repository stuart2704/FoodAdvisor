import { useState, type FormEvent } from 'react';
import { FlaskConical, Send } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TestOutreachResponse {
  success: boolean;
  error?: string;
  result?: {
    status?: string;
    reason?: string;
  };
}

export function TestOutreach() {
  const [restaurantId, setRestaurantId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTestOutreach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = restaurantId.trim();
    if (!id) return;

    const confirmed = window.confirm(
      'This may queue a real outreach email to the selected restaurant. Continue?',
    );
    if (!confirmed) return;

    setSubmitting(true);
    setResult(null);
    setError(null);
    try {
      const response = await fetch('/dashboard/test-outreach', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId: id, confirm: true }),
      });
      const data = (await response.json()) as TestOutreachResponse;
      if (response.status === 401) {
        window.location.assign('/admin/login');
        return;
      }
      if (!response.ok || !data.success) {
        setError(data.error ?? 'Test outreach could not run.');
        return;
      }
      setResult(
        data.result?.status === 'queued'
          ? 'Outreach was accepted by Instantly and queued. Delivery is not yet confirmed.'
          : 'Outreach completed successfully.',
      );
    } catch {
      setError('Could not reach the outreach service.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-card-border shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <FlaskConical className="h-5 w-5 text-primary" />
          AI Outreach Test
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Generate and queue initial outreach for one eligible restaurant.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={runTestOutreach} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Google Place ID</span>
            <input
              value={restaurantId}
              onChange={(event) => setRestaurantId(event.target.value)}
              required
              maxLength={512}
              placeholder="Enter an eligible restaurant ID"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <button
            type="submit"
            disabled={submitting || !restaurantId.trim()}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Running test…' : 'Run AI Outreach Test'}
          </button>
          <p className="text-xs text-muted-foreground">
            This may send a real email. Existing daily limits, suppression checks, claim checks,
            duplicate protection, and recipient validation still apply.
          </p>
          {result ? (
            <p role="status" className="rounded-xl bg-primary/10 px-4 py-3 text-sm text-primary">
              {result}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}