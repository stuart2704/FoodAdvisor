import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Crown, ExternalLink, Loader2, MapPin, Search } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RestaurantMap } from '@/components/restaurant-map';
import { Reviews } from '@/components/reviews';
import { BookingForm } from '@/components/booking-form';
import { FavouriteButton } from '@/components/favourite-button';
import { ShareButtons } from '@/components/share-buttons';

interface RestaurantProfile {
  id: string;
  name: string;
  cuisine: string | null;
  city: string;
  region: string | null;
  country: string;
  globalRegion: string | null;
  slug: string | null;
  priceLevel: string | null;
  premium: boolean;
  rankingScore: number;
  description: string | null;
  phone: string | null;
  address: string;
  website: string | null;
  deliveryUrl: string | null;
  googleMapsUrl: string;
  rating: number | null;
  lat: number | null;
  lng: number | null;
  deliveryPlatforms: string[];
  openingHours: string[] | null;
  menu: Array<{ id?: number; name?: string; description?: string | null; price?: string | null; category?: string }>;
  photos: Array<{ id?: string; url?: string; alt?: string }>;
  analytics: Record<string, unknown> | null;
  claimed: boolean;
  claimUrl: string | null;
}

interface SimilarRestaurant {
  id: string;
  name: string;
  city: string;
  cuisine: string | null;
  rating: number | null;
  premium: boolean;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="font-serif text-2xl">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function RestaurantPage() {
  const params = useParams<{ id?: string; slug?: string }>();
  const id = params.id ?? params.slug ?? '';
  const usesSlug = Boolean(params.slug);
  const [data, setData] = useState<RestaurantProfile | null>(null);
  const [error, setError] = useState('');
  const [similar, setSimilar] = useState<SimilarRestaurant[]>([]);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    setSimilar([]);
    setAiDescription(null);
    void fetch(
      usesSlug
        ? `/api/restaurants/${encodeURIComponent(id)}`
        : `/api/restaurant/${encodeURIComponent(id)}`,
      {
      signal: controller.signal,
      cache: 'no-store',
      },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          success: boolean;
          data?: RestaurantProfile;
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Restaurant not found.');
        }
        document.title = `${payload.data.name} | The Food Advisor`;
        setData(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Restaurant not found.');
        }
      });
    return () => controller.abort();
  }, [id, usesSlug]);

  useEffect(() => {
    if (!data?.id) return;
    const controller = new AbortController();
    void fetch(`/api/restaurants/${encodeURIComponent(data.id)}/similar`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success: boolean;
          data?: SimilarRestaurant[];
        };
        if (response.ok && payload.success && payload.data) {
          setSimilar(payload.data);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [data?.id]);

  useEffect(() => {
    if (!data?.id) return;
    const controller = new AbortController();
    void fetch(`/api/ai/${encodeURIComponent(data.id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          description?: string | null;
        };
        if (response.ok && payload.description) {
          setAiDescription(payload.description);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [data?.id]);

  useEffect(() => {
    if (!data) return;
    const observed = [
      ...(data.photos.length ? [{ element: galleryRef.current, type: 'photo_view' }] : []),
      ...(data.menu.length ? [{ element: menuRef.current, type: 'menu_view' }] : []),
    ] as Array<{ element: HTMLDivElement | null; type: 'photo_view' | 'menu_view' }>;
    const sent = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = observed.find(({ element }) => element === entry.target);
          if (!item || sent.has(item.type)) continue;
          sent.add(item.type);
          observer.unobserve(entry.target);
          void fetch('/api/analytics/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restaurantId: data.id, type: item.type }),
            keepalive: true,
          });
        }
      },
      { threshold: 0.35 },
    );
    observed.forEach(({ element }) => {
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [data]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-destructive" role="alert">{error}</p>
        <Button variant="outline" asChild><Link href="/restaurants">Browse restaurants</Link></Button>
      </div>
    );
  }
  if (!data) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10 md:px-12 md:py-14">
        <header className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-primary">
              {data.cuisine ?? 'Restaurant'} · {data.city}
              {data.region ? `, ${data.region}` : ''}
              {data.country ? ` · ${data.country}` : ''}
            </p>
            {data.premium && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Crown className="h-3.5 w-3.5" /> Premium
              </span>
            )}
          </div>
          <h1 className="mt-3 font-serif text-4xl font-semibold md:text-6xl">{data.name}</h1>
          {(aiDescription ?? data.description) && (
            <p className="mt-5 text-lg leading-8 text-muted-foreground">
              {aiDescription ?? data.description}
            </p>
          )}
          <FavouriteButton restaurantId={data.id} />
          {data.slug && <ShareButtons slug={data.slug} />}
          {data.rating !== null && (
            <p className="mt-4 font-medium"><span className="text-amber-500">★</span> {data.rating.toFixed(1)}</p>
          )}
        </header>

        {data.photos.length > 0 && (
          <div ref={galleryRef}>
            <Section title="Gallery">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.photos.map((photo, index) =>
                  photo.url ? <img key={photo.id ?? photo.url} src={photo.url} alt={photo.alt ?? `${data.name} photo ${index + 1}`} className="aspect-[4/3] w-full rounded-lg object-cover" /> : null,
                )}
              </div>
            </Section>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div ref={menuRef}>
            <Section title="Menu">
              {data.menu.length ? (
                <div className="divide-y divide-border">
                  {data.menu.map((item, index) => (
                    <div key={item.id ?? `${item.name}-${index}`} className="py-3 first:pt-0">
                       <div className="flex justify-between gap-4"><span className="font-medium">{item.name ?? 'Menu item'}</span><span>{item.price ? `£${item.price}` : ''}</span></div>
                      {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
                       {item.category && <p className="mt-1 text-xs text-muted-foreground">{item.category}</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">A verified menu has not been added yet.</p>}
            </Section>
          </div>
          <Section title="Opening Hours">
            {data.openingHours?.length ? (
              <ul className="space-y-2 text-sm">{data.openingHours.map((hours) => <li key={hours}>{hours}</li>)}</ul>
            ) : <p className="text-sm text-muted-foreground">Verified opening hours are not available yet.</p>}
          </Section>
        </div>

        <Section title="Location">
          {data.lat !== null && data.lng !== null ? (
            <div className="mb-5">
              <RestaurantMap lat={data.lat} lng={data.lng} />
            </div>
          ) : null}
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p>{data.address}</p>
              <a href={data.googleMapsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                Open in Google Maps <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          {data.deliveryUrl && (
            <a
              href={data.deliveryUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-block rounded bg-fa-gold px-4 py-2 font-semibold text-fa-black"
            >
              Order Delivery
            </a>
          )}
        </Section>
        <Reviews restaurantId={data.id} />
        <BookingForm restaurantId={data.id} />

        {!data.claimed && data.claimUrl && (
          <Button asChild size="lg">
            <a href={data.claimUrl} className="claim-button">
              Claim this restaurant
            </a>
          </Button>
        )}
        {data.premium && (
          <Section title="Analytics">
            <p className="text-sm text-muted-foreground">
              {data.analytics ? 'Verified analytics are available to the restaurant owner.' : 'Verified reporting data is not available yet.'}
            </p>
          </Section>
        )}
        {similar.length > 0 && (
          <Section title="Similar restaurants">
            <div className="grid gap-4 sm:grid-cols-2">
              {similar.map((restaurant) => (
                <Link
                  key={restaurant.id}
                  href={`/restaurant/${restaurant.id}`}
                  className="rounded-xl border border-border p-4 transition hover:border-primary/50 hover:bg-secondary/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-lg font-semibold">{restaurant.name}</h3>
                    {restaurant.premium ? <Crown className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {restaurant.cuisine ?? 'Restaurant'} · {restaurant.city}
                  </p>
                  {restaurant.rating !== null ? (
                    <p className="mt-2 text-sm font-medium">
                      <span className="text-amber-500">★</span> {restaurant.rating.toFixed(1)}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </Section>
        )}
      </main>
    </div>
  );
}