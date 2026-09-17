import { useEffect } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface HeatmapPoint {
  cuisine: string;
  lat: number;
  lng: number;
}

function HeatLayer({ points }: { points: HeatmapPoint[] }) {
  const map = useMap();

  useEffect(() => {
    const layer = L.heatLayer(
      points.map((point) => [point.lat, point.lng, 1]),
      {
        radius: 28,
        blur: 22,
        maxZoom: 10,
        minOpacity: 0.35,
      },
    );
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points]);

  return null;
}

export function Heatmap({ points }: { points: HeatmapPoint[] }) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      scrollWheelZoom={false}
      className="h-[400px] w-full rounded-xl border border-border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <HeatLayer points={points} />
    </MapContainer>
  );
}