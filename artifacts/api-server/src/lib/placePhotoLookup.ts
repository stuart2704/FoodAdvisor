import { budgetedPlacesFetch } from "./budgetedPlacesFetch";

// Keep provider metadata and URIs briefly, in memory only. Never cache image bytes.
// The bounded cache avoids retaining old Places content indefinitely.
const TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;
export type PlacePhoto = {
  url: string;
  attribution: Array<{ displayName: string; uri: string | null }>;
};
type PhotoMetadata = { name: string; authorAttributions?: Array<{ displayName?: string; uri?: string }> };
type CacheEntry<T> = { value: T; expiresAt: number };
const detailsCache = new Map<string, CacheEntry<PhotoMetadata[]>>();
const mediaCache = new Map<string, CacheEntry<string | null>>();
const detailsPending = new Map<string, Promise<PhotoMetadata[]>>();
const mediaPending = new Map<string, Promise<string | null>>();

function cached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function remember<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

function share<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = work();
  pending.set(key, promise);
  void promise.finally(() => pending.delete(key)).catch(() => {});
  return promise;
}

async function photoDetails(placeId: string, apiKey: string): Promise<PhotoMetadata[]> {
  const hit = cached(detailsCache, placeId);
  if (hit) return hit;
  return share(detailsPending, placeId, async () => {
    const response = await budgetedPlacesFetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      { headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "photos" } },
      "Place photo details",
    );
    if (!response.ok) throw new Error(`Google Places photo details returned ${response.status}`);
    const payload = await response.json() as { photos?: PhotoMetadata[] };
    const photos = (payload.photos ?? []).filter(
      (photo) => typeof photo.name === "string" && /^places\/[^/]+\/photos\/[^/]+$/.test(photo.name),
    ).slice(0, 6);
    remember(detailsCache, placeId, photos);
    return photos;
  });
}

async function photoUri(name: string, apiKey: string): Promise<string | null> {
  const hit = cached(mediaCache, name);
  if (hit !== undefined) return hit;
  return share(mediaPending, name, async () => {
    const response = await budgetedPlacesFetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": apiKey } },
      "Place photo media",
    );
    if (!response.ok) throw new Error(`Google Places photo media returned ${response.status}`);
    const payload = await response.json() as { photoUri?: unknown };
    const url = typeof payload.photoUri === "string" && payload.photoUri.startsWith("https://")
      ? payload.photoUri : null;
    remember(mediaCache, name, url);
    return url;
  });
}

export async function getPlacePhotos(placeId: string, apiKey: string, count: number): Promise<PlacePhoto[]> {
  const details = (await photoDetails(placeId, apiKey)).slice(0, count);
  const photos: PlacePhoto[] = [];
  for (const detail of details) {
    const url = await photoUri(detail.name, apiKey);
    if (!url) continue;
    photos.push({
      url,
      attribution: (detail.authorAttributions ?? [])
        .filter((author) => typeof author.displayName === "string")
        .map((author) => ({
          displayName: author.displayName!,
          uri: typeof author.uri === "string" && author.uri.startsWith("https://") ? author.uri : null,
        })),
    });
  }
  return photos;
}