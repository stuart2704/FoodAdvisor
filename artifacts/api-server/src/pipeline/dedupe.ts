import { isDuplicate as checkDuplicate } from "./neonClient";
import { logEvent } from "../utils/eventLog";

// Google Place ID identifies a location; name and city can match other branches.
// This preflight check does not replace atomic conflict handling on insertion.
export async function isDuplicate(restaurant: unknown): Promise<boolean> {
  const duplicate = await checkDuplicate(restaurant);
  if (duplicate) logEvent("info", "Duplicate restaurant detected by Google Place ID");
  return duplicate;
}