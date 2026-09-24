import { ESTIMATED_GRID_REQUEST_COST_CENTS, MONTHLY_PAID_BUDGET_GBP } from "./gridCrawlPlan";
import { reservePaidPlacesCall } from "./gridCrawlRuntime";

export class PlacesBudgetExceededError extends Error {
  constructor() {
    super("The monthly Google Places request budget has been reached.");
    this.name = "PlacesBudgetExceededError";
  }
}

/** A failed or uncertain provider response still consumes its reservation. */
export async function budgetedPlacesFetch(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  if (new URL(url).origin !== "https://places.googleapis.com") {
    throw new Error("Budgeted Places fetch requires the Google Places origin.");
  }
  const reservation = await reservePaidPlacesCall({
    label,
    requested: 1,
    costCents: ESTIMATED_GRID_REQUEST_COST_CENTS,
    monthlyBudgetCents: MONTHLY_PAID_BUDGET_GBP * 100,
  });
  if (reservation === null) throw new PlacesBudgetExceededError();
  return fetch(url, init);
}