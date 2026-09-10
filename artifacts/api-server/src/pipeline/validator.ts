import { z } from "zod";
import { logEvent } from "../utils/eventLog";

const publicUrl = z.string().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Expected an HTTP(S) URL without credentials");

const restaurantSchema = z.object({
  placeId: z.string().trim().min(1).max(512),
  name: z.string().trim().min(1).max(500),
  address: z.string().trim().min(1).max(2000),
  city: z.string().trim().min(1).max(200),
  rating: z.preprocess(parseNumericString, z.number().finite().min(0).max(5).nullable().optional()),
  reviewsCount: z.preprocess(parseNumericString, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()),
  website: publicUrl.nullable().optional(),
  googleMapsUrl: publicUrl,
  types: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});

export type QueuedRestaurant = Omit<z.infer<typeof restaurantSchema>, "reviewsCount">;

function parseNumericString(value: unknown): unknown {
  return typeof value === "string" && value.trim() !== "" ? Number(value) : value;
}

export function parseRestaurant(input: unknown): QueuedRestaurant {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid restaurant: expected an object.");
  }
  const value = input as Record<string, unknown>;
  const parsed = restaurantSchema.safeParse({
    ...value,
    placeId: value.placeId ?? value.id,
    googleMapsUrl: value.googleMapsUrl ?? value.mapsUrl,
  });
  if (!parsed.success) {
    logEvent("error", "Restaurant validation failed; nothing queued or inserted");
    throw new Error("Invalid restaurant: Google Place ID, name, address, city, and Maps URL are required; check field formats.");
  }
  // Validate this optional field, but do not write a nonexistent DB column.
  const { reviewsCount: _reviewsCount, ...restaurant } = parsed.data;
  return restaurant;
}

export function validateRestaurant(input: unknown): boolean {
  try {
    parseRestaurant(input);
    return true;
  } catch {
    return false;
  }
}