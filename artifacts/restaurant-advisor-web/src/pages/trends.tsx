import { useEffect, useState } from 'react';
import { Link } from 'wouter';

interface TrendsData {
  cuisines: Array<{ cuisine: string; count: number }>;
  cities: Array<{ city: string; count: number }>;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function TrendsPage() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/trends', { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: TrendsData;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Food trends are unavailable.');
        }
        setData(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Food trends are unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Directory insights</p>
      <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">
        Global food trends
      </h1>
      {error && <p className="mt-8 text-destructive" role="alert">{error}</p>}
      {!data && !error && <p className="mt-8 text-muted-foreground">Loading trends…</p>}
      {data && (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-2xl font-semibold">Top cuisines</h2>
            <ol className="mt-5 space-y-3">
              {data.cuisines.map((item, index) => (
                <li key={item.cuisine} className="flex justify-between gap-4">
                  <Link
                    href={`/cuisine/${encodeURIComponent(item.cuisine)}`}
                    className="font-semibold hover:text-primary"
                  >
                    {index + 1}. {item.cuisine}
                  </Link>
                  <span className="text-muted-foreground">{item.count}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-2xl font-semibold">Top cities</h2>
            <ol className="mt-5 space-y-3">
              {data.cities.map((item, index) => (
                <li key={item.city} className="flex justify-between gap-4">
                  <Link
                    href={`/cities/${slugify(item.city)}`}
                    className="font-semibold hover:text-primary"
                  >
                    {index + 1}. {item.city}
                  </Link>
                  <span className="text-muted-foreground">{item.count}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}