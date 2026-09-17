import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';

interface MatchResult {
  id: string;
  name: string;
  slug: string | null;
  city: string;
  region: string | null;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
}

export default function MatchPage() {
  const [cuisine, setCuisine] = useState('');
  const [region, setRegion] = useState('');
  const [results, setResults] = useState<MatchResult[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function findMatches(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const response = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuisine, region }),
      });
      const payload = (await response.json()) as {
        success?: boolean;
        results?: MatchResult[];
        error?: string;
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Matches are unavailable.');
      }
      setResults(payload.results ?? []);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : 'Matches are unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <h1 className="font-serif text-4xl font-semibold">Find your perfect restaurant</h1>
      <p className="mt-3 text-muted-foreground">
        Tell us which cuisine and region you want to explore.
      </p>
      <form onSubmit={findMatches} className="mt-8 space-y-4">
        <input
          required
          maxLength={100}
          className="w-full rounded-md border border-input bg-background p-3"
          placeholder="Cuisine"
          value={cuisine}
          onChange={(event) => setCuisine(event.target.value)}
        />
        <input
          required
          maxLength={100}
          className="w-full rounded-md border border-input bg-background p-3"
          placeholder="Region"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-fa-red px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Matching…' : 'Match me'}
        </button>
      </form>
      {error && <p className="mt-6 text-destructive" role="alert">{error}</p>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="mt-6 text-muted-foreground">No matching restaurants found.</p>
      )}
      <ul className="mt-8 space-y-4">
        {results.map((restaurant) => (
          <li key={restaurant.id} className="rounded-lg border p-5 shadow-sm">
            <Link
              href={
                restaurant.slug
                  ? `/restaurants/${restaurant.slug}`
                  : `/restaurant/${encodeURIComponent(restaurant.id)}`
              }
              className="font-serif text-xl font-semibold hover:text-fa-red"
            >
              {restaurant.name}
            </Link>
            <p className="mt-1 text-sm text-muted-foreground">
              {restaurant.cuisine ?? 'Restaurant'} · {restaurant.city}
              {restaurant.rating !== null ? ` · ★ ${restaurant.rating.toFixed(1)}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}