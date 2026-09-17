import { useMemo } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface ClusterRestaurant {
  id: string;
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
}

export function ClusterMap({
  restaurants,
}: {
  restaurants: ClusterRestaurant[];
}) {
  const clusters = useMemo(() => {
    const grouped = new Map<string, ClusterRestaurant[]>();
    restaurants
      .filter(
        (restaurant) =>
          restaurant.lat !== null &&
          restaurant.lng !== null &&
          Number.isFinite(restaurant.lat) &&
          Number.isFinite(restaurant.lng),
      )
      .forEach((restaurant) => {
        const key = `${restaurant.lat!.toFixed(1)}:${restaurant.lng!.toFixed(1)}`;
        grouped.set(key, [...(grouped.get(key) ?? []), restaurant]);
      });
    return [...grouped.values()];
  }, [restaurants]);

  if (clusters.length === 0) return null;
  const points = clusters.flat();
  const center: [number, number] = [
    points.reduce((total, item) => total + item.lat!, 0) / points.length,
    points.reduce((total, item) => total + item.lng!, 0) / points.length,
  ];

  return (
    <section className="space-y-4">
      <h2 className="font-serif text-2xl font-semibold">Featured restaurant map</h2>
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom={false}
        className="h-[400px] w-full rounded-xl border border-border"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {clusters.map((cluster) => {
          const lat =
            cluster.reduce((total, item) => total + item.lat!, 0) / cluster.length;
          const lng =
            cluster.reduce((total, item) => total + item.lng!, 0) / cluster.length;
          return (
            <CircleMarker
              key={`${lat}:${lng}`}
              center={[lat, lng]}
              radius={cluster.length === 1 ? 8 : Math.min(22, 9 + cluster.length)}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: '#d7263d',
                fillOpacity: 0.9,
              }}
            >
              <Popup>
                <strong>
                  {cluster.length === 1
                    ? cluster[0].name
                    : `${cluster.length} featured restaurants`}
                </strong>
                <div>{[...new Set(cluster.map((item) => item.city))].join(', ')}</div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </section>
  );
}