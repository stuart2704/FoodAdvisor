import { useEffect, useState } from 'react';
import { ArrowRight, Building2, Loader2, Search } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface CitySummary {
  city: string;
  slug: string;
  count: number;
}

export default function CitiesPage() {
  const [cities, setCities] = useState<CitySummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Cities | The Food Advisor';
    const controller = new AbortController();
    void fetch('/api/cities', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as CitySummary[] | {
          error?: string;
        };
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error(
            !Array.isArray(payload) && payload.error
              ? payload.error
              : 'Cities are unavailable.',
          );
        }
        setCities(payload);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error ? failure.message : 'Cities are unavailable.',
          );
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-12">
          <Link href="/" className="font-serif text-2xl font-semibold">
            The Food Advisor
          </Link>
          <Button asChild>
            <Link href="/search">
              <Search className="mr-2 h-4 w-4" /> Search
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header className="max-w-2xl">
          <div className="mb-4 inline-flex rounded-full bg-primary/10 p-3 text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-4xl font-semibold md:text-6xl">
            Explore by city
          </h1>
          <p className="mt-4 text-muted-foreground">
            Browse ranked restaurants in each destination.
          </p>
        </header>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        {!cities && !error && (
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        )}
        {cities?.length === 0 && (
          <p className="text-muted-foreground">No cities are available yet.</p>
        )}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cities?.map((city) => (
            <Link key={city.slug} href={`/cities/${city.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between gap-4 p-6">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold">
                      {city.city}
                    </h2>
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