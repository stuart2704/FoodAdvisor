import { normalizeAddress } from "./addressNormalize";

// Process-local pre-promotion filter. Do not use this for outreach opt-outs.
const entries = new Set<string>();
export const suppressionList: ReadonlySet<string> = entries;

function restaurantKey(name: string, address: string | null): string | null {
  const normalizedName = name.trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedAddress = normalizeAddress(address)?.toLowerCase();
  if (!normalizedName || !normalizedAddress) return null;
  return JSON.stringify([normalizedName, normalizedAddress]);
}

export function suppressRestaurant(name: string, address: string | null): void {
  const key = restaurantKey(name, address);
  if (!key) throw new Error("A name and address are required to suppress a candidate.");
  entries.add(key);
}

export function isSuppressedRestaurant(name: string, address: string | null): boolean {
  const key = restaurantKey(name, address);
  return key !== null && entries.has(key);
}