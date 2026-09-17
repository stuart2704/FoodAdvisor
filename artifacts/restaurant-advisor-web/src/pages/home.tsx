import { useEffect, useState } from 'react';
import { Crown, Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

interface HomepageRestaurant {
  id: string;
  name: string;
  city: string;
  country: string;
  cuisine: string | null;
  tags: string[];
  rating: number | null;
  premium: boolean;
}

interface HomepageData {
  featured: HomepageRestaurant[];
  trending: HomepageRestaurant[];
  premium: HomepageRestaurant[];
  cityHighlights: Record<string, HomepageRestaurant[]>;
  cuisineHighlights: Record<string, HomepageRestaurant[]>;
  globalDiscovery: HomepageRestaurant[];
}

function Section({
  title,
  items,
}: {
  title: string;
  items: HomepageRestaurant[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="font-serif text-2xl font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((restaurant) => (
          <Card key={restaurant.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-serif text-xl font-semibold">{restaurant.name}</h3>
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
                <p className="mt-3 text-sm font-medium" aria-label={`${restaurant.rating} out of 5 stars`}>
                  <span className="text-amber-500">★</span> {restaurant.rating.toFixed(1)}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const [data, setData] = useState<HomepageData | null>(null);
  const [recommended, setRecommended] = useState<HomepageRestaurant[]>([]);
  const [trendingNearby, setTrendingNearby] = useState<HomepageRestaurant[]>([]);
  const [topCuisine, setTopCuisine] = useState<{
    cuisine: string;
    items: HomepageRestaurant[];
  } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    document.title = 'The Food Advisor | Discover Restaurants';
    const controller = new AbortController();
    const visitorId = window.localStorage.getItem('foodAdvisorVisitorId');
    void fetch('/homepage', {
      signal: controller.signal,
      cache: 'no-store',
      ...(visitorId ? { headers: { 'X-Visitor-Id': visitorId } } : {}),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success: boolean;
          data?: HomepageData;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Homepage recommendations are unavailable.');
        }
        setData(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Homepage recommendations are unavailable.');
        }
      });
    if (visitorId) {
      void fetch('/api/recommendations', {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'X-Visitor-Id': visitorId },
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            success: boolean;
            data?: HomepageRestaurant[];
          };
          if (response.ok && payload.success && payload.data) {
            setRecommended(payload.data);
          }
        })
        .catch(() => undefined);
      void fetch('/api/recommendations/trending', {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'X-Visitor-Id': visitorId },
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            success: boolean;
            data?: HomepageRestaurant[];
          };
          if (response.ok && payload.success && payload.data) {
            setTrendingNearby(payload.data);
          }
        })
        .catch(() => undefined);
      void fetch('/api/recommendations/top-cuisine', {
        signal: controller.signal,
        cache: 'no-store',
        headers: { 'X-Visitor-Id': visitorId },
      })
        .then(async (response) => {
          const payload = (await response.json()) as {
            success: boolean;
            cuisine?: string;
            data?: HomepageRestaurant[];
          };
          if (
            response.ok &&
            payload.success &&
            payload.cuisine &&
            payload.data
          ) {
            setTopCuisine({
              cuisine: payload.cuisine,
              items: payload.data,
            });
          }
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, []);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-destructive" role="alert">{error}</div>;
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-7xl space-y-12 px-6 py-10 md:px-12 md:py-14">
        <section className="max-w-3xl">
          <p className="text-sm font-semibold text-primary">Restaurant discovery, ranked intelligently</p>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-6xl">
            The Food Advisor
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Explore restaurants across cities, regions, and countries worldwide.
          </p>
        </section>
        <section className="grid gap-6 md:grid-cols-3" aria-label="Browse restaurant directories">
          {[
            {
              href: '/cities',
              title: 'Cities',
              description: 'Browse restaurants by city.',
            },
            {
              href: '/regions',
              title: 'Regions',
              description: 'Explore UK and global regions.',
            },
            {
              href: '/countries',
              title: 'Countries',
              description: 'Discover restaurants worldwide.',
            },
          ].map((directory) => (
            <Link key={directory.href} href={directory.href}>
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-muted/30">
                <CardContent className="p-6">
                  <h2 className="font-serif text-2xl font-semibold">
                    {directory.title}
                  </h2>
                  <p className="mt-2 text-muted-foreground">
                    {directory.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
        <Section title="Featured Restaurants" items={data.featured} />
        <Section title="Recommended for you" items={recommended} />
        <Section title="Trending in your area" items={trendingNearby} />
        {topCuisine ? (
          <Section
            title={`Top ${topCuisine.cuisine} picks`}
            items={topCuisine.items}
          />
        ) : null}
        <Section title="Trending Now" items={data.trending} />
        <Section title="Premium Highlights" items={data.premium} />
        {Object.entries(data.cityHighlights).map(([city, items]) => (
          <Section key={city} title={`Top in ${city}`} items={items} />
        ))}
        {Object.entries(data.cuisineHighlights).map(([cuisine, items]) => (
          <Section key={cuisine} title={`Best ${cuisine}`} items={items} />
        ))}
        <Section title="Global Discovery" items={data.globalDiscovery} />
      </main>
    </div>
  );
}