import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';

interface AdminRestaurant {
  placeId: string;
  slug: string | null;
  name: string;
  city: string;
  region: string | null;
}

export default function ManageRestaurantsPage() {
  const [, navigate] = useLocation();
  const [restaurants, setRestaurants] = useState<AdminRestaurant[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/dashboard/restaurants?page=1&limit=100', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          restaurants?: AdminRestaurant[];
          error?: string;
        };
        if (response.status === 401) {
          navigate('/admin/login', { replace: true });
          return;
        }
        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? 'Restaurants could not be loaded.');
        }
        setRestaurants(payload.restaurants ?? []);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Restaurants could not be loaded.',
          );
        }
      });
    return () => controller.abort();
  }, [navigate]);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-4xl font-semibold">Manage Restaurants</h1>
        <Link href="/admin/add-restaurant" className="rounded-md bg-fa-red px-4 py-2 font-semibold text-white">
          Add Restaurant
        </Link>
      </div>
      {error && <p className="text-destructive" role="alert">{error}</p>}
      {!restaurants && !error && <p>Loading restaurants…</p>}
      <ul className="space-y-4">
        {restaurants?.map((restaurant) => (
          <li key={restaurant.placeId} className="rounded-lg border p-4 shadow-sm">
            <strong>{restaurant.name}</strong>
            <br />
            {restaurant.city}{restaurant.region ? `, ${restaurant.region}` : ''}
            <br />
            <Link
              href={restaurant.slug ? `/admin/restaurants/${restaurant.slug}` : `/restaurant/${encodeURIComponent(restaurant.placeId)}`}
              className="text-fa-red underline"
            >
              {restaurant.slug ? 'Edit' : 'View listing'}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}