import { db, restaurantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { and, isNull } from "drizzle-orm";
import {
  ClaimLinkConfigurationError,
  verifyClaimLink,
} from "../lib/claim-link";
import { startOnboarding } from "./onboardingService";
import { z } from "zod";
import { withInstantlyRestaurantLock } from "../outreach/instantlyService";
import { enqueueAllInstantlyCancellationIntents } from "./instantly/cancellationIntents";

export interface ClaimPageData {
  id: string;
  name: string;
  city: string;
  address: string;
  cuisine: string | null;
  claimed: boolean;
  claimAvailable: boolean;
}

const ClaimSubmission = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  role: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).optional(),
  brandStyle: z.string().trim().max(100).optional().default(""),
  openingHours: z.array(z.string().trim().min(1).max(120)).max(14).default([]),
  deliveryPlatforms: z
    .array(z.string().trim().min(1).max(80))
    .max(20)
    .default([]),
  website: z.string().trim().url().max(2_048).optional().or(z.literal("")),
  socialLinks: z
    .record(z.string().trim().min(1).max(40), z.string().trim().url().max(2_048))
    .refine((links) => Object.keys(links).length <= 12)
    .default({}),
});

export type ClaimSubmissionData = z.infer<typeof ClaimSubmission>;

export type ClaimPageResult =
  | { kind: "available"; data: ClaimPageData }
  | { kind: "invalid_link" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export async function getClaimPage(
  id: string,
  claimToken: string,
): Promise<ClaimPageResult> {
  const placeId = id.trim();
  const token = claimToken.trim();
  if (!placeId || placeId.length > 512 || !token) {
    return { kind: "invalid_link" };
  }
  try {
    if (!verifyClaimLink(token, placeId)) {
      return { kind: "invalid_link" };
    }
  } catch (error) {
    if (error instanceof ClaimLinkConfigurationError) {
      return { kind: "unavailable" };
    }
    throw error;
  }

  const [restaurant] = await db
    .select({
      id: restaurantsTable.placeId,
      name: restaurantsTable.name,
      city: restaurantsTable.city,
      address: restaurantsTable.address,
      cuisineTags: restaurantsTable.cuisineTags,
      claimStatus: restaurantsTable.claimStatus,
    })
    .from(restaurantsTable)
    .where(eq(restaurantsTable.placeId, placeId))
    .limit(1);
  if (!restaurant) return { kind: "not_found" };
  const claimed = restaurant.claimStatus !== null;

  return {
    kind: "available",
    data: {
      id: restaurant.id,
      name: restaurant.name,
      city: restaurant.city,
      address: restaurant.address,
      cuisine: restaurant.cuisineTags[0] ?? null,
      claimed,
      claimAvailable: !claimed,
    },
  };
}

export async function getClaimData(
  id: string,
  claimToken: string,
): Promise<ClaimPageData | null> {
  const result = await getClaimPage(id, claimToken);
  return result.kind === "available" ? result.data : null;
}

export async function submitClaim(
  id: string,
  form: unknown,
  claimToken: string,
): Promise<
  | { success: true; portalToken: string }
  | { success: false; reason: "invalid" | "claimed" | "not_found" }
> {
  const placeId = id.trim();
  const parsed = ClaimSubmission.safeParse(form);
  if (!parsed.success || !verifyClaimLink(claimToken, placeId)) {
    return { success: false, reason: "invalid" };
  }
  const result = await withInstantlyRestaurantLock(placeId, () =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          placeId: restaurantsTable.placeId,
          claimStatus: restaurantsTable.claimStatus,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, placeId))
        .limit(1);
      if (!existing) return "not_found" as const;
      if (existing.claimStatus !== null) return "claimed" as const;
      const [updated] = await tx
        .update(restaurantsTable)
        .set({
          claimEmail: parsed.data.email.toLocaleLowerCase("en-GB"),
          ownerName: parsed.data.name,
          ownerRole: parsed.data.role,
          ownerPhone: parsed.data.phone || null,
          brandStyle: parsed.data.brandStyle || null,
          openingHours: parsed.data.openingHours,
          deliveryPlatforms: parsed.data.deliveryPlatforms,
          website: parsed.data.website || null,
          socialLinks: parsed.data.socialLinks,
          claimStatus: "basic",
        })
        .where(
          and(
            eq(restaurantsTable.placeId, placeId),
            isNull(restaurantsTable.claimStatus),
          ),
        )
        .returning({ placeId: restaurantsTable.placeId });
      if (updated) {
        await enqueueAllInstantlyCancellationIntents(tx, updated.placeId);
      }
      return updated ? "claimed_now" as const : "claimed" as const;
    }),
  );
  if (result !== "claimed_now") {
    return { success: false, reason: result };
  }
  const onboarding = await startOnboarding(placeId);
  return { success: true, portalToken: onboarding.portalToken };
}

export default { getClaimPage, getClaimData, submitClaim };