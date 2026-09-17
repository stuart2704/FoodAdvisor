import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';

interface FranchiseRestaurant {
  id: string;
  slug: string | null;
  name: string;
  city: string;
  premium: boolean;
}

export default function FranchisePage() {
  const { brand = '' } = useParams<{ brand: string }>();
  const [list, setList] = useState<FranchiseRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetch(`/api/franchise/${encodeURIComponent(brand)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: FranchiseRestaurant[];
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Brand locations are unavailable.');
        }
        setList(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Brand locations are unavailable.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [brand]);

  const brandName = decodeURIComponent(brand);
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Restaurant brands</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        {brandName} locations
      </h1>
      {loading && <p className="mt-8 text-muted-foreground">Loading locations…</p>}
      {error && <p className="mt-8 text-destructive" role="alert">{error}</p>}
      {!loading && !error && list.length === 0 && (
        <p className="mt-8 text-muted-foreground">
          No locations are currently listed for this brand.
        </p>
      )}
      <ul className="mt-10 space-y-3">
        {list.map((restaurant) => (
          <li key={restaurant.id} className="rounded-xl border border-border bg-card p-5">
            <Link
              href={
                restaurant.slug
                  ? `/restaurants/${restaurant.slug}`
                  : `/restaurant/${encodeURIComponent(restaurant.id)}`
              }
              className="font-serif text-xl font-semibold hover:text-primary"
            >
              {restaurant.name}
            </Link>
            <span className="ml-2 text-muted-foreground">· {restaurant.city}</span>
            {restaurant.premium && (
              <span className="ml-3 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                Premium
              </span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}