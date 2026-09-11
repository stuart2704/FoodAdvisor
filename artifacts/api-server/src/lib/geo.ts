export const DEFAULT_NEARBY_RADIUS_MILES = 5;
export const MIN_NEARBY_RADIUS_MILES = 1;
export const MAX_NEARBY_RADIUS_MILES = 25;

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function normaliseCoordinates(
  location: { latitude?: unknown; longitude?: unknown } | null | undefined,
): Coordinates | null {
  const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const latitude = toNumber(location?.latitude);
  const longitude = toNumber(location?.longitude);
  return latitude !== null &&
    longitude !== null &&
    isValidLatitude(latitude) &&
    isValidLongitude(longitude)
    ? { latitude, longitude }
    : null;
}

export function haversineDistanceMiles(
  from: Coordinates,
  to: Coordinates,
): number {
  const earthRadiusMiles = 3958.7613;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(to.latitude - from.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const latitude1 = radians(from.latitude);
  const latitude2 = radians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}