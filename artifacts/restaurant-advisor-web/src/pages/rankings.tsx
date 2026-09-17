import { useEffect, useState } from 'react';
import { Link } from 'wouter';

interface RankedRestaurant {
  id: string;
  slug: string | null;
  name: string;
  city: string;
  score: number;
  premium: boolean;
}

export default function RankingsPage() {
  const [list, setList] = useState<RankedRestaurant[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/rank', { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: RankedRestaurant[];
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Rankings are unavailable.');
        }
        setList(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Rankings are unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Discovery ranking</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Top restaurants
      </h1>
      {error && <p className="mt-8 text-destructive" role="alert">{error}</p>}
      {!error && list.length === 0 && <p className="mt-8 text-muted-foreground">Loading rankings…</p>}
      <ol className="mt-10 space-y-3">
        {list.map((restaurant, index) => (
          <li key={restaurant.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-5">
            <span className="w-8 text-xl font-semibold text-muted-foreground">{index + 1}</span>
            <Link
              href={
                restaurant.slug
                  ? `/restaurants/${restaurant.slug}`
                  : `/restaurant/${encodeURIComponent(restaurant.id)}`
              }
              className="min-w-0 flex-1 font-serif text-xl font-semibold hover:text-primary"
            >
              {restaurant.name} <span className="text-sm font-normal text-muted-foreground">· {restaurant.city}</span>
            </Link>
            {restaurant.premium && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">Premium</span>}
            <span className="font-mono text-sm">{restaurant.score.toFixed(2)}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}