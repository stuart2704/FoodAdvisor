import { budgetedPlacesFetch } from "./budgetedPlacesFetch";
import { sharedPlacePhotoLookup } from "./sharedPlacePhotoCache";

export type PlacePhoto = {
  url: string;
  attribution: Array<{ displayName: string; uri: string | null }>;
};
type PhotoMetadata = { name: string; authorAttributions?: Array<{ displayName?: string; uri?: string }> };
const detailsPending = new Map<string, Promise<PhotoMetadata[]>>();
const mediaPending = new Map<string, Promise<string | null>>();

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
  return share(detailsPending, `${apiKey}:${placeId}`, () => sharedPlacePhotoLookup("details", placeId, apiKey, async () => {
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
    return photos;
  }));
}

async function photoUri(name: string, apiKey: string): Promise<string | null> {
  return share(mediaPending, `${apiKey}:${name}`, () => sharedPlacePhotoLookup("media", name, apiKey, async () => {
    const response = await budgetedPlacesFetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": apiKey } },
      "Place photo media",
    );
    if (!response.ok) throw new Error(`Google Places photo media returned ${response.status}`);
    const payload = await response.json() as { photoUri?: unknown };
    const url = typeof payload.photoUri === "string" && payload.photoUri.startsWith("https://")
      ? payload.photoUri : null;
    return url;
  }));
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