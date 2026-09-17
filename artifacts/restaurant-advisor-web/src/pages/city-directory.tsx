import { useEffect, useState } from 'react';
import { Crown, Loader2, Search } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

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
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-12">
          <Link href="/" className="font-serif text-2xl font-semibold">The Food Advisor</Link>
          <Button asChild><Link href="/search"><Search className="mr-2 h-4 w-4" /> Search</Link></Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header>
          <p className="text-sm font-semibold text-primary">{data.restaurants.length} restaurants</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">Restaurants in {data.city}</h1>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.restaurants.map((restaurant) => (
            <Link key={restaurant.id} href={restaurant.slug ? `/restaurants/${restaurant.slug}` : `/restaurant/${encodeURIComponent(restaurant.id)}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-serif text-2xl font-semibold">{restaurant.name}</h2>
                    {restaurant.premium && <Crown className="h-5 w-5 shrink-0 text-primary" />}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {restaurant.cuisineTags[0] ?? 'Restaurant'}
                    {restaurant.rating !== null ? ` · ★ ${restaurant.rating.toFixed(1)}` : ''}
                  </p>
                  <p className="mt-4 text-sm text-foreground/80">
                    {restaurant.address}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {restaurant.city}
                    {restaurant.region ? `, ${restaurant.region}` : ''}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}