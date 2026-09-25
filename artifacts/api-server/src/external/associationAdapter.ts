import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

export const associationAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // TODO: implement ingestion from restaurant associations
    // Only if license explicitly allows reuse.
    return [];
  },
};