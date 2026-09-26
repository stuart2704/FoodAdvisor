/** Place Details (New) Enterprise + Atmosphere fields. Never classify page text as a venue fact. */
export const AMENITY_DETAILS_MASK =
  "id,delivery,takeout,outdoorSeating,accessibilityOptions,servesVegetarianFood";

type PlaceDetails = {
  id?: unknown;
  delivery?: unknown;
  takeout?: unknown;
  outdoorSeating?: unknown;
  servesVegetarianFood?: unknown;
  accessibilityOptions?: {
    wheelchairAccessibleEntrance?: unknown;
    wheelchairAccessibleSeating?: unknown;
    wheelchairAccessibleRestroom?: unknown;
    wheelchairAccessibleParking?: unknown;
  } | null;
};

/** Null means the response supplied no positive OR negative amenity evidence. */
export function verifiedAmenities(value: unknown, expectedPlaceId: string): string[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Place Details response.");
  const details = value as PlaceDetails;
  if (details.id !== expectedPlaceId) throw new Error("Place Details ID does not match the requested venue.");
  const flags: [string, unknown][] = [
    ["delivery", details.delivery],
    ["takeaway", details.takeout],
    ["outdoor_seating", details.outdoorSeating],
    ["vegetarian", details.servesVegetarianFood],
  ];
  const access = details.accessibilityOptions;
  if (access && typeof access === "object" && !Array.isArray(access)) {
    const values = [
      access.wheelchairAccessibleEntrance,
      access.wheelchairAccessibleSeating,
      access.wheelchairAccessibleRestroom,
      access.wheelchairAccessibleParking,
    ];
    flags.push(["wheelchair", values.includes(true) ? true : values.every((v) => v === false) ? false : undefined]);
  }
  for (const [, flag] of flags) {
    if (flag !== undefined && flag !== null && typeof flag !== "boolean") {
      throw new Error("Invalid Place Details amenity value.");
    }
  }
  const known = flags.filter(([, flag]) => typeof flag === "boolean");
  return known.length ? known.filter(([, flag]) => flag === true).map(([tag]) => tag) : null;
}

/** One request only. A timeout or HTTP failure may be billable; callers must not retry. */
export async function fetchPlaceAmenities(
  placeId: string, apiKey: string, fetcher: typeof fetch = fetch,
): Promise<string[] | null> {
  const response = await fetcher(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": AMENITY_DETAILS_MASK },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Place Details failed (${response.status}); charged reservation retained.`);
  return verifiedAmenities(await response.json() as unknown, placeId);
}