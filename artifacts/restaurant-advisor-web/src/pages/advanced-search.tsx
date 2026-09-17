import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';

interface AdvancedSearchResult {
  id: string;
  name: string;
  slug: string | null;
  city: string;
  region: string | null;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
  relevance: number;
}

const initialFilters = {
  q: '',
  cuisine: '',
  city: '',
  region: '',
  minRating: '',
};

export default function AdvancedSearchPage() {
  const [filters, setFilters] = useState(initialFilters);
  const [results, setResults] = useState<AdvancedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    setLoading(true);
    setSearched(true);
    setError('');
    try {
      const response = await fetch(`/api/search-advanced?${params.toString()}`, {
        cache: 'no-store',
      });
      const payload = (await response.json()) as {
        success?: boolean;
        results?: AdvancedSearchResult[];
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Search is temporarily unavailable.');
      }
      setResults(payload.results ?? []);
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
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Advanced search</h1>
      <p className="mt-3 text-muted-foreground">
        Combine restaurant, cuisine, location, and rating filters.
      </p>
      <form onSubmit={search} className="mt-8 grid gap-4 sm:grid-cols-2">
        {(['q', 'cuisine', 'city', 'region'] as const).map((field) => (
          <label key={field}>
            <span className="mb-1 block capitalize">
              {field === 'q' ? 'Restaurant or keyword' : field}
            </span>
            <input
              value={filters[field]}
              maxLength={120}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
              className="w-full rounded-md border border-input bg-background p-3"
            />
          </label>
        ))}
        <label>
          <span className="mb-1 block">Minimum rating</span>
          <input
            type="number"
            min="0"
            max="5"
            step="0.1"
            value={filters.minRating}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                minRating: event.target.value,
              }))
            }
            className="w-full rounded-md border border-input bg-background p-3"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="self-end rounded bg-fa-red px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="mt-6 text-destructive" role="alert">{error}</p>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="mt-6 text-muted-foreground">No matching restaurants found.</p>
      )}
      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {results.map((restaurant) => (
          <li key={restaurant.id} className="rounded-lg border border-border p-5">
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
            <p className="mt-2 text-sm text-muted-foreground">
              {restaurant.cuisine ?? 'Restaurant'} · {restaurant.city}
              {restaurant.rating !== null ? ` · ★ ${restaurant.rating.toFixed(1)}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}