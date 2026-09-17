import { useEffect, useMemo, useState } from 'react';
import { Heatmap, type HeatmapPoint } from '@/components/heatmap';

export default function HeatmapPage() {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [cuisine, setCuisine] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/heatmap', { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          data?: HeatmapPoint[];
          error?: string;
        };
        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error ?? 'Cuisine map data is unavailable.');
        }
        setPoints(payload.data);
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
          setError(failure instanceof Error ? failure.message : 'Cuisine map data is unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  const cuisines = useMemo(
    () => [...new Set(points.map((point) => point.cuisine))].sort(),
    [points],
  );
  const visiblePoints =
    cuisine === 'all'
      ? points
      : points.filter((point) => point.cuisine === cuisine);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12 md:px-12">
      <p className="text-sm font-semibold text-primary">Cuisine distribution</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl font-semibold md:text-6xl">
            Global cuisine heatmap
          </h1>
          <p className="mt-3 text-muted-foreground">
            Based on restaurants with stored map coordinates.
          </p>
        </div>
        <label>
          <span className="mb-1 block text-sm font-semibold">Cuisine</span>
          <select
            value={cuisine}
            onChange={(event) => setCuisine(event.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="all">All cuisines</option>
            {cuisines.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="mt-8 text-destructive" role="alert">{error}</p>
      ) : (
        <div className="mt-8">
          <Heatmap points={visiblePoints} />
          <p className="mt-3 text-sm text-muted-foreground">
            Showing {visiblePoints.length.toLocaleString()} cuisine-location points.
          </p>
        </div>
      )}
    </main>
  );
}