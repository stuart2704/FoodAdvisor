import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface DashboardRestaurant {
  placeId: string;
  name: string;
  address: string;
  city: string;
  country: string;
  rating: number | null;
  website: string | null;
  publicBusinessEmail: string | null;
  outreachStatus: string;
  outreachCount: number;
  claimStatus: string | null;
  importedAt: string;
}

interface RestaurantsResponse {
  success: boolean;
  page: number;
  limit: number;
  total: number;
  restaurants: DashboardRestaurant[];
  error?: string;
}

const PAGE_SIZE = 25;

export function DashboardRestaurants() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RestaurantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/dashboard/restaurants?page=${page}&limit=${PAGE_SIZE}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as RestaurantsResponse;
        if (!result.success) {
          window.location.assign('/admin/login');
          return null;
        }
        if (!response.ok) {
          throw new Error(result.error ?? 'Restaurants could not be loaded.');
        }
        return result;
      })
      .then((result) => {
        if (result) setData(result);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Restaurants could not be loaded.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [page, revision]);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <Card className="border-card-border shadow-sm">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="text-xl">Restaurants</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.total.toLocaleString()} stored restaurants` : 'Stored restaurant listings'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevision((value) => value + 1)}
          className="rounded-lg border border-border p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Refresh restaurants"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Restaurant</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Claim</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && !data ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Loading restaurants…
                    </TableCell>
                  </TableRow>
                ) : data?.restaurants.length ? (
                  data.restaurants.map((restaurant) => (
                    <TableRow key={restaurant.placeId}>
                      <TableCell>
                        <div className="font-semibold">{restaurant.name}</div>
                        <div className="max-w-xs truncate text-xs text-muted-foreground">
                          {restaurant.address}
                        </div>
                      </TableCell>
                      <TableCell>{restaurant.city}, {restaurant.country}</TableCell>
                      <TableCell>{restaurant.rating?.toFixed(1) ?? '—'}</TableCell>
                      <TableCell className="capitalize">
                        {restaurant.outreachStatus.replaceAll('_', ' ')}
                      </TableCell>
                      <TableCell>{restaurant.publicBusinessEmail ?? '—'}</TableCell>
                      <TableCell className="capitalize">
                        {restaurant.claimStatus?.replaceAll('_', ' ') ?? 'Unclaimed'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No restaurants found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="rounded-lg border border-border p-2 transition hover:bg-secondary disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={page >= pageCount || loading}
              onClick={() => setPage((value) => value + 1)}
              className="rounded-lg border border-border p-2 transition hover:bg-secondary disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}