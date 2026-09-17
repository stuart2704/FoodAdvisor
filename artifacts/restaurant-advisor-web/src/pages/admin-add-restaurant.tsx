import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';

const initialForm = {
  name: '',
  address: '',
  city: '',
  region: '',
  country: '',
  cuisine: '',
  rating: '',
};

export default function AddRestaurantPage() {
  const [, navigate] = useLocation();
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/restaurants', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          region: form.region.trim() || null,
          cuisine: form.cuisine.trim() || null,
          rating: form.rating.trim() ? Number(form.rating) : null,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
      };
      if (response.status === 401) {
        navigate('/admin/login', { replace: true });
        return;
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Restaurant could not be created.');
      }
      navigate('/admin/restaurants');
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Restaurant could not be created.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold">Add Restaurant</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        {Object.entries(form).map(([key, value]) => (
          <label key={key} className="block">
            <span className="mb-1 block capitalize">{key}</span>
            <input
              type={key === 'rating' ? 'number' : 'text'}
              min={key === 'rating' ? 0 : undefined}
              max={key === 'rating' ? 5 : undefined}
              step={key === 'rating' ? 0.1 : undefined}
              required={['name', 'address', 'city', 'country'].includes(key)}
              value={value}
              onChange={(event) =>
                setForm((current) => ({ ...current, [key]: event.target.value }))
              }
              className="w-full rounded-md border border-input bg-background p-3"
            />
          </label>
        ))}
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-fa-red px-4 py-2 font-semibold text-white hover:bg-fa-red/90 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add Restaurant'}
        </button>
      </form>
    </main>
  );
}