import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

export const govRegistryAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // TODO: implement ingestion from government business registries
    // Must check license per jurisdiction.
    return [];
  },
};