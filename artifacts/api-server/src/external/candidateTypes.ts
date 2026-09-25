export type ExternalCandidate = {
  sourceId: string;        // stable per provider
  sourceName: string;      // e.g. "OSM", "GovRegistry"
  rawName: string;
  rawAddress: string | null;
  rawCoords: { lat: number; lon: number } | null;
  rawPhone: string | null;
  rawWebsite: string | null;
  sourceFlags: string[];   // e.g. ["open-data", "government"]
  importedAt: string;      // ISO timestamp
};

export interface ExternalAdapter {
  fetch(params: { now: Date }): Promise<ExternalCandidate[]>;
}