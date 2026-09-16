import { useEffect, useRef, useState } from 'react';
import { Crown, Loader2, Search } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { recordRestaurantClick } from '@/lib/analytics';

interface DirectoryRestaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
}

interface DirectoryData {
  page: number;
  total: number;
  totalPages: number;
  items: DirectoryRestaurant[];
}

export default function DirectoryPage() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<DirectoryRestaurant[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadedPages = useRef(new Set<number>());
  const requestInFlight = useRef(false);

  useEffect(() => {
    document.title = 'All Restaurants | The Food Advisor';
  }, []);

  useEffect(() => {
    if (
      loadedPages.current.has(page) ||
      requestInFlight.current ||
      (totalPages !== null && page > totalPages)
    ) {
      return;
    }
    const controller = new AbortController();
    requestInFlight.current = true;
    setLoading(true);
    setError('');
    void fetch(`/api/directory?page=${page}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success: boolean;
          data?: DirectoryData;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'The restaurant directory is unavailable.');
        }
        loadedPages.current.add(page);
        setItems((previous) => {
          const known = new Set(previous.map((restaurant) => restaurant.id));
          return [
            ...previous,
            ...payload.data!.items.filter((restaurant) => !known.has(restaurant.id)),
          ];
        });
        setTotal(payload.data.total);
        setTotalPages(payload.data.totalPages);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'The restaurant directory is unavailable.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          requestInFlight.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      requestInFlight.current = false;
    };
  }, [page, totalPages]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          entry?.isIntersecting &&
          !requestInFlight.current &&
          (totalPages === null || page < totalPages)
        ) {
          setPage((current) => current + 1);
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [page, totalPages]);

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
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header>
          <p className="text-sm font-semibold text-primary">{total.toLocaleString()} restaurants</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">All Restaurants</h1>
        </header>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((restaurant) => (
            <Link
              key={restaurant.id}
              href={`/restaurant/${encodeURIComponent(restaurant.id)}`}
              onClick={() => recordRestaurantClick(restaurant.id)}
              className="block"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-serif text-xl font-semibold">{restaurant.name}</h2>
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
                    <p className="mt-3 text-sm font-medium"><span className="text-amber-500">★</span> {restaurant.rating.toFixed(1)}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
        {!loading && items.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No restaurants are available on this page.</p>
        )}
        <div ref={sentinelRef} className="flex min-h-12 items-center justify-center" aria-live="polite">
          {loading && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading more restaurants…</span>}
          {!loading && totalPages !== null && page >= totalPages && items.length > 0 && (
            <span className="text-sm text-muted-foreground">You’ve reached the end.</span>
          )}
        </div>
      </main>
    </div>
  );
}