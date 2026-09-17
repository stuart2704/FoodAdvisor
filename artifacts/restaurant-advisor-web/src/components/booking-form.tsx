import { useState, type FormEvent } from 'react';

export function BookingForm({ restaurantId }: { restaurantId: string }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    date: '',
    time: '',
    guests: '2',
  });
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatus('');
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId,
          ...form,
          guests: Number(form.guests),
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Booking request could not be submitted.');
      }
      setStatus(payload.message ?? 'Booking request received.');
      setForm({ name: '', email: '', date: '', time: '', guests: '2' });
    } catch (failure: unknown) {
      setStatus(
        failure instanceof Error
          ? failure.message
          : 'Booking request could not be submitted.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-border p-6">
      <h2 className="font-serif text-2xl font-bold">Request a table</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        This sends a request. The restaurant must confirm availability separately.
      </p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        {(['name', 'email', 'date', 'time', 'guests'] as const).map((field) => (
          <label key={field}>
            <span className="mb-1 block capitalize">{field}</span>
            <input
              type={
                field === 'email'
                  ? 'email'
                  : field === 'date'
                    ? 'date'
                    : field === 'time'
                      ? 'time'
                      : field === 'guests'
                        ? 'number'
                        : 'text'
              }
              min={field === 'date' ? new Date().toISOString().slice(0, 10) : field === 'guests' ? '1' : undefined}
              max={field === 'guests' ? '20' : undefined}
              required
              value={form[field]}
              onChange={(event) =>
                setForm((current) => ({ ...current, [field]: event.target.value }))
              }
              className="w-full rounded-md border border-input bg-background p-3"
            />
          </label>
        ))}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-fa-red px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-2"
        >
          {submitting ? 'Sending…' : 'Send booking request'}
        </button>
      </form>
      {status && <p className="mt-4 text-sm" role="status">{status}</p>}
    </section>
  );
}