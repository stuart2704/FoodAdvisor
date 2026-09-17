import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'wouter';

interface EditableRestaurant {
  name: string;
  address: string;
  city: string;
  region: string;
  country: string;
  cuisine: string;
  rating: string;
  deliveryUrl: string;
}

export default function EditRestaurantPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const [restaurant, setRestaurant] = useState<EditableRestaurant | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/restaurants/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: {
            name: string;
            address: string;
            city: string;
            region: string | null;
            country: string;
            cuisine: string | null;
            rating: number | null;
            deliveryUrl: string | null;
          };
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Restaurant could not be loaded.');
        }
        setRestaurant({
          name: payload.data.name,
          address: payload.data.address,
          city: payload.data.city,
          region: payload.data.region ?? '',
          country: payload.data.country,
          cuisine: payload.data.cuisine ?? '',
          rating: payload.data.rating?.toString() ?? '',
          deliveryUrl: payload.data.deliveryUrl ?? '',
        });
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Restaurant could not be loaded.',
          );
        }
      });
    return () => controller.abort();
  }, [slug]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restaurant) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/restaurants/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...restaurant,
          region: restaurant.region.trim() || null,
          cuisine: restaurant.cuisine.trim() || null,
          rating: restaurant.rating.trim() ? Number(restaurant.rating) : null,
          deliveryUrl: restaurant.deliveryUrl.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        data?: { slug?: string | null };
        error?: string;
      };
      if (response.status === 401) {
        navigate('/admin/login', { replace: true });
        return;
      }
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Restaurant could not be saved.');
      }
      navigate('/admin/restaurants');
    } catch (failure: unknown) {
      setError(
        failure instanceof Error ? failure.message : 'Restaurant could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (!restaurant && !error) {
    return <main className="mx-auto max-w-3xl px-6 py-10">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <h1 className="font-serif text-4xl font-semibold">Edit Restaurant</h1>
      {restaurant && (
        <form onSubmit={handleSave} className="space-y-4">
          {Object.entries(restaurant).map(([key, value]) => (
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
                  setRestaurant((current) =>
                    current ? { ...current, [key]: event.target.value } : current,
                  )
                }
                className="w-full rounded-md border border-input bg-background p-3"
              />
            </label>
          ))}
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-fa-red px-4 py-2 font-semibold text-white hover:bg-fa-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
      {error && <p className="text-destructive" role="alert">{error}</p>}
    </main>
  );
}