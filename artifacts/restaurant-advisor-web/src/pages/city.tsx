import { useEffect, useState } from 'react';
import { Crown, Loader2, Search } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface CityRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
}

interface CityData {
  city: string;
  country: string;
  restaurantCount: number;
  top: CityRestaurant[];
  premium: CityRestaurant[];
  trending: CityRestaurant[];
  cuisineSections: Record<string, CityRestaurant[]>;
  discovery: CityRestaurant[];
}

function Section({ title, items }: { title: string; items: CityRestaurant[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-2xl font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((restaurant) => (
          <Card key={restaurant.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-serif text-xl font-semibold">{restaurant.name}</h3>
                {restaurant.premium && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    <Crown className="h-3.5 w-3.5" /> Premium
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {restaurant.cuisine ?? 'Restaurant'} · {restaurant.city}
              </p>
              {restaurant.rating !== null && (
                <p className="mt-3 text-sm font-medium">
                  <span className="text-amber-500">★</span> {restaurant.rating.toFixed(1)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function CityPage() {
  const { city = '' } = useParams<{ city: string }>();
  const [data, setData] = useState<CityData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    void fetch(`/api/city/${encodeURIComponent(city)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success: boolean;
          data?: CityData;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'City recommendations are unavailable.');
        }
        document.title = `Best Restaurants in ${payload.data.city} | The Food Advisor`;
        setData(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'City recommendations are unavailable.');
        }
      });
    return () => controller.abort();
  }, [city]);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-destructive" role="alert">{error}</div>;
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-12">
          <Link href="/" className="font-serif text-2xl font-semibold">The Food Advisor</Link>
          <Button asChild>
            <Link href="/search"><Search className="mr-2 h-4 w-4" /> Search</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-12 px-6 py-10 md:px-12 md:py-14">
        <header>
          <p className="text-sm font-semibold text-primary">{data.restaurantCount} restaurants ranked</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
            Best Restaurants in {data.city}
          </h1>
        </header>
        <Section title="Top Restaurants" items={data.top} />
        <Section title="Premium Highlights" items={data.premium} />
        <Section title="Trending Now" items={data.trending} />
        {Object.entries(data.cuisineSections).map(([cuisine, items]) => (
          <Section key={cuisine} title={`Best ${cuisine} in ${data.city}`} items={items} />
        ))}
        <Section title="Discover More" items={data.discovery} />
      </main>
    </div>
  );
}