import { useEffect, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

interface RegionData {
  region: string;
  cities: Array<{
    city: string;
    slug: string;
    count: number;
  }>;
}

export default function RegionPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<RegionData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    void fetch(`/api/regions/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as RegionData & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? 'Region destinations are unavailable.');
        }
        document.title = `Restaurants in ${payload.region} | The Food Advisor`;
        setData(payload);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Region destinations are unavailable.',
          );
        }
      });
    return () => controller.abort();
  }, [slug]);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-destructive" role="alert">{error}</div>;
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header>
          <p className="text-sm font-semibold text-primary">
            {data.cities.reduce((total, city) => total + city.count, 0).toLocaleString()} restaurants
          </p>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
            Restaurants in {data.region}
          </h1>
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.cities.map((city) => (
            <Link key={city.slug} href={`/cities/${city.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between gap-4 p-6">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold">{city.city}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {city.count.toLocaleString()} restaurants
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-primary" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}