import { useEffect, useState, type FormEvent } from 'react';
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

interface AutocompleteResult {
  id: string;
  name: string;
  slug: string | null;
  city: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [autocomplete, setAutocomplete] = useState<AutocompleteResult[]>([]);

  useEffect(() => {
    document.title = 'Search Restaurants | The Food Advisor';
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setAutocomplete([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q });
      void fetch(`/api/autocomplete?${params.toString()}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            success?: boolean;
            results?: AutocompleteResult[];
          };
          if (response.ok && payload.success) {
            setAutocomplete(payload.results ?? []);
          }
        })
        .catch((failure: unknown) => {
          if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
            setAutocomplete([]);
          }
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    setHasSearched(true);
    setResults([]);
    setError('');
    if (!q) return;

    const controller = new AbortController();
    setLoading(true);
    try {
      const params = new URLSearchParams({ q });
      const response = await fetch(`/api/search?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = (await response.json()) as {
        success: boolean;
        results?: SearchResult[];
        error?: string;
      };
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? 'Search is temporarily unavailable.');
      }
      setResults(data.results ?? []);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Search is temporarily unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background p-6 text-foreground md:p-12">
      <main className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="text-sm font-semibold text-primary">The Food Advisor</p>
          <h1 className="mt-2 font-serif text-4xl font-semibold">Search restaurants</h1>
          <Link href="/advanced-search" className="mt-3 inline-block font-semibold text-primary hover:underline">
            Use advanced filters
          </Link>
        </header>
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by city or restaurant…"
              className="h-12 pl-12 text-base"
              aria-label="Search by city or restaurant"
              aria-autocomplete="list"
              aria-controls="restaurant-autocomplete"
            />
            {autocomplete.length > 0 && (
              <ul
                id="restaurant-autocomplete"
                className="absolute z-20 mt-2 w-full overflow-hidden rounded-lg border border-border bg-white p-2 shadow-lg"
              >
                {autocomplete.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={
                        item.slug
                          ? `/restaurants/${item.slug}`
                          : `/restaurant/${encodeURIComponent(item.id)}`
                      }
                      onClick={() => setAutocomplete([])}
                      className="block rounded-md px-3 py-2 hover:bg-muted"
                    >
                      <span className="font-medium">{item.name}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {item.city}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-6 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!loading && hasSearched && !error && results.length === 0 && (
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