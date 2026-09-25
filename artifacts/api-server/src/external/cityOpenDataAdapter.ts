import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

export const cityOpenDataAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // TODO: implement real city open-data ingestion
    // This is a placeholder returning an empty list.
    return [];
  },
};