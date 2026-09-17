import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Map } from 'lucide-react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

interface RegionSummary {
  region: string;
  slug: string;
  count: number;
}

export default function RegionsPage() {
  const [regions, setRegions] = useState<RegionSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Regions | The Food Advisor';
    const controller = new AbortController();
    void fetch('/api/regions', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as RegionSummary[] | {
          error?: string;
        };
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error(
            !Array.isArray(payload) && payload.error
              ? payload.error
              : 'Regions are unavailable.',
          );
        }
        setRegions(payload);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(
            failure instanceof Error ? failure.message : 'Regions are unavailable.',
          );
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header className="max-w-2xl">
          <div className="mb-4 inline-flex rounded-full bg-primary/10 p-3 text-primary">
            <Map className="h-5 w-5" />
          </div>
          <h1 className="font-serif text-4xl font-semibold md:text-6xl">
            Explore by region
          </h1>
          <p className="mt-4 text-muted-foreground">
            Choose a region to discover its restaurant destinations.
          </p>
        </header>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        {!regions && !error && (
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        )}
        {regions?.length === 0 && (
          <p className="text-muted-foreground">No regions are available yet.</p>
        )}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {regions?.map((region) => (
            <Link key={region.slug} href={`/regions/${region.slug}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between gap-4 p-6">
                  <div>
                    <h2 className="font-serif text-2xl font-semibold">
                      {region.region}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {region.count.toLocaleString()} restaurants
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