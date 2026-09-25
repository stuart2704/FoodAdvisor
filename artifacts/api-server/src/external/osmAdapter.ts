import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

export const osmAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // TODO: implement real OSM / Overpass queries
    // This is just a skeleton; returns an empty list for now.
    return [];
  },
};