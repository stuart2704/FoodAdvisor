import { useEffect, useState } from 'react';
import { Crown, Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'wouter';
import { recordRestaurantClick } from '@/lib/analytics';

interface SearchResult {
  id: string;
  name: string;
  cuisine: string | null;
  city: string;
  country: string;
  tags: string[];
  premium: boolean;
  rankingScore: number;
  slug: string | null;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'Search Restaurants | The Food Advisor';
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ q: trimmed });
      void fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          const data = (await response.json()) as {
            success: boolean;
            results?: SearchResult[];
            error?: string;
          };
          if (!response.ok || !data.success) {
            throw new Error(data.error ?? 'Search is temporarily unavailable.');
          }
          setResults(data.results ?? []);
        })
        .catch((failure: unknown) => {
          if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
            setError(failure instanceof Error ? failure.message : 'Search is temporarily unavailable.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="text-sm font-semibold text-primary">The Food Advisor</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Search restaurants</h1>
        </header>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search restaurants…"
            className="h-12 pl-12 text-base"
            aria-label="Search restaurants"
          />
        </div>
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && query.trim() && !error && results.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching restaurants found.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {results.map((restaurant) => (
            <Link
              key={restaurant.id}
              href={
                restaurant.slug
                  ? `/restaurants/${restaurant.slug}`
                  : `/restaurant/${encodeURIComponent(restaurant.id)}`
              }
              onClick={() => recordRestaurantClick(restaurant.id)}
              className="block"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-serif text-xl font-semibold">{restaurant.name}</h2>
                    {restaurant.premium && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        <Crown className="h-3.5 w-3.5" /> Premium
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {restaurant.cuisine ?? 'Restaurant'} · {restaurant.city}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}