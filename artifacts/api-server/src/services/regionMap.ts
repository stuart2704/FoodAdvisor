export interface RestaurantRegion {
  region: string;
  country: string;
  globalRegion: string;
}

export const REGION_MAP = {
  Cardiff: {
    region: "Wales",
    country: "UK",
    globalRegion: "Europe",
  },
  Swansea: {
    region: "Wales",
    country: "UK",
    globalRegion: "Europe",
  },
  Newport: {
    region: "Wales",
    country: "UK",
    globalRegion: "Europe",
  },
  London: {
    region: "England",
    country: "UK",
    globalRegion: "Europe",
  },
  Manchester: {
    region: "England",
    country: "UK",
    globalRegion: "Europe",
  },
  Birmingham: {
    region: "England",
    country: "UK",
    globalRegion: "Europe",
  },
  Edinburgh: {
    region: "Scotland",
    country: "UK",
    globalRegion: "Europe",
  },
  Glasgow: {
    region: "Scotland",
    country: "UK",
    globalRegion: "Europe",
  },
  Belfast: {
    region: "Northern Ireland",
    country: "UK",
    globalRegion: "Europe",
  },
  "New York": {
    region: "New York State",
    country: "USA",
    globalRegion: "North America",
  },
  Tokyo: {
    region: "Kanto",
    country: "Japan",
    globalRegion: "Asia",
  },
  Paris: {
    region: "Île-de-France",
    country: "France",
    globalRegion: "Europe",
  },
} as const satisfies Record<string, RestaurantRegion>;

const NORMALISED_REGION_MAP = new Map(
  Object.entries(REGION_MAP).map(([city, region]) => [
    city.toLocaleLowerCase("en-GB"),
    region,
  ]),
);

export function getRegionForCity(city: string): RestaurantRegion | null {
  const region = NORMALISED_REGION_MAP.get(
    city.trim().toLocaleLowerCase("en-GB"),
  );
  return region ? { ...region } : null;
}