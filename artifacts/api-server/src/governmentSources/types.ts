export type GovernmentSource = "FSA_UK" | "ALIM_FR" | "NYC_DOHMH";

export interface GovernmentListing {
  source: GovernmentSource;
  sourceId: string;
  name: string;
  address: string;
  city: string;
  region: string | null;
  country: string;
  currency: string;
  latitude: number | null;
  longitude: number | null;
  attribution: string;
  sourceUrl: string;
}

export interface GovernmentPage {
  listings: GovernmentListing[];
  scanned: number;
  nextCursor: string | null;
}