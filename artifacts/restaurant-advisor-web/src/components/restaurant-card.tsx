import { Crown } from 'lucide-react';
import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

export interface RestaurantCardData {
  id: string;
  slug: string | null;
  name: string;
  address: string;
  city: string;
  region: string | null;
  cuisine: string | null;
  rating: number | null;
  premium?: boolean;
}

export function RestaurantCard({
  restaurant,
}: {
  restaurant: RestaurantCardData;
}) {
  const href = restaurant.slug
    ? `/restaurants/${restaurant.slug}`
    : `/restaurant/${encodeURIComponent(restaurant.id)}`;

  return (
    <Link href={href} className="block h-full">
      <Card className="h-full transition-colors hover:border-fa-red/40 hover:bg-gray-50">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-serif text-2xl font-bold">{restaurant.name}</h2>
            {restaurant.premium && (
              <Crown
                className="h-5 w-5 shrink-0 text-fa-gold"
                aria-label="Premium restaurant"
              />
            )}
          </div>
          <p className="mt-4 text-sm text-foreground/80">{restaurant.address}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {restaurant.city}
            {restaurant.region ? `, ${restaurant.region}` : ''}
          </p>
          <p className="mt-3 text-sm text-gray-600">
            Cuisine: {restaurant.cuisine ?? 'Restaurant'}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Rating: {restaurant.rating !== null ? restaurant.rating.toFixed(1) : 'Not rated'}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}