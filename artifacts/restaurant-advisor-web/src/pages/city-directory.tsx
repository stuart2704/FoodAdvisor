import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useParams } from 'wouter';
import { RestaurantCard } from '@/components/restaurant-card';

interface CityDirectoryData {
  city: string;
  restaurants: Array<{
    id: string;
    slug: string | null;
    name: string;
    address: string;
    city: string;
    region: string | null;
    country: string | null;
    cuisineTags: string[];
    rating: number | null;
    premium: boolean;
  }>;
}

export default function CityDirectoryPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<CityDirectoryData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/cities/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as CityDirectoryData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'City not found.');
        document.title = `Restaurants in ${payload.city} | The Food Advisor`;
        setData(payload);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'City not found.');
        }
      });
    return () => controller.abort();
  }, [slug]);

  if (error) return <div className="flex min-h-screen items-center justify-center p-6 text-destructive" role="alert">{error}</div>;
  if (!data) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header>
          <p className="text-sm font-semibold text-primary">{data.restaurants.length} restaurants</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">Restaurants in {data.city}</h1>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.restaurants.map((restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={{
                ...restaurant,
                cuisine: restaurant.cuisineTags[0] ?? null,
              }}
            />
          ))}
        </section>
      </main>
    </div>
  );
}