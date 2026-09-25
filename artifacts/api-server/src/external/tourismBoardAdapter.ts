import type { ExternalAdapter, ExternalCandidate } from "./candidateTypes";

export const tourismBoardAdapter: ExternalAdapter = {
  async fetch({ now }): Promise<ExternalCandidate[]> {
    // TODO: implement ingestion from tourism boards with open data
    return [];
  },
};