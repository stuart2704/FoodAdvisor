import { db, restaurantsTable, outreachAuditTable } from "@workspace/db";
import { eq, and, or, isNull, isNotNull, ne, inArray } from "drizzle-orm";
import { StatusMap, isValidStatus, type RestaurantStatus } from "./statusMap";
import { logEvent } from "../utils/eventLog";

function validateId(id: string): string {
  if (typeof id !== "string" || !id.trim() || id.trim().length > 512) {
    throw new Error("A valid Google Place ID is required.");
  }
  return id.trim();
}

function workflowStatus(row: typeof restaurantsTable.$inferSelect): RestaurantStatus | null {
  if (row.suppressedAt || row.outreachStatus === "suppressed") return StatusMap.CLOSED;
  switch (row.outreachStatus) {
    case "pending": return StatusMap.NOT_CONTACTED;
    case "sent": return StatusMap.CONTACTED;
    case "followup_sent": return StatusMap.FOLLOWUP_SENT;
    case "final_followup_sent": return StatusMap.FINAL_FOLLOWUP_SENT;
    case "interested":
    case "upgrade": return StatusMap.ENGAGED;
    case "question": return StatusMap.AWAITING_FOLLOWUP;
    case "replied": return StatusMap.UNKNOWN_REPLY;
    case "send_failed": return StatusMap.ERROR;
    // Sending and out-of-office have no equivalent in the supplied label set.
    default: return null;
  }
}

export async function getStatus(restaurantId: string): Promise<RestaurantStatus | null> {
  const placeId = validateId(restaurantId);
  try {
    const [row] = await db.select().from(restaurantsTable)
      .where(eq(restaurantsTable.placeId, placeId)).limit(1);
    if (!row) throw new Error("Restaurant not found.");
    return workflowStatus(row);
  } catch {
    logEvent("error", "Restaurant status could not be read");
    throw new Error("Restaurant status is unavailable or the restaurant does not exist.");
  }
}

/**
 * Internal status adapter, not an unprotected route.
 * Claim/payment state is never modified. Operational failures and milestones
 * must be recorded by their owning services, not disguised as outreach state.
 */
export async function updateStatus(restaurantId: string, newStatus: string) {
  const placeId = validateId(restaurantId);
  if (!isValidStatus(newStatus)) throw new Error("Invalid workflow status.");
  if ([StatusMap.SCRAPED, StatusMap.INSERTED, StatusMap.ERROR].some((value) => value === newStatus)) {
    throw new Error("This operational status must be recorded by the responsible service.");
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(restaurantsTable)
        .where(eq(restaurantsTable.placeId, placeId)).limit(1).for("update");
      if (!row) throw new Error("Restaurant not found.");
      const current = workflowStatus(row);
      if (current === newStatus) return { id: placeId, status: current, changed: false };
      if (row.suppressedAt || row.outreachStatus === "suppressed" || row.claimedAt
        || row.outreachStatus === "sending") {
        throw new Error("Restaurant status is protected.");
      }
      let storedStatus: string;
      switch (newStatus) {
        case StatusMap.NOT_CONTACTED: {
          const [attempt] = await tx.select({ id: outreachAuditTable.id })
            .from(outreachAuditTable).where(and(
              eq(outreachAuditTable.placeId, placeId),
              eq(outreachAuditTable.event, "send_attempt"),
            )).limit(1);
          if (attempt || row.outreachCount > 0 || row.lastOutreachAt || row.outreachStatus !== "pending") {
            throw new Error("Existing outreach cannot be reset.");
          }
          storedStatus = "pending";
          break;
        }
        case StatusMap.CONTACTED:
        case StatusMap.FOLLOWUP_SENT:
        case StatusMap.FINAL_FOLLOWUP_SENT:
          // Only the Gmail sending transaction can establish sent status.
          throw new Error("Contacted status must be recorded by the Gmail sender.");
        case StatusMap.ENGAGED:
        case StatusMap.AWAITING_FOLLOWUP:
        case StatusMap.UNKNOWN_REPLY:
          if (!["sent", "followup_sent", "final_followup_sent", "interested", "upgrade", "question", "replied"].includes(row.outreachStatus)) {
            throw new Error("No existing outreach conversation.");
          }
          storedStatus = newStatus === StatusMap.ENGAGED ? "interested"
            : newStatus === StatusMap.AWAITING_FOLLOWUP ? "question" : "replied";
          break;
        case StatusMap.CLOSED:
          storedStatus = "suppressed";
          break;
        default:
          throw new Error("Unsupported status transition.");
      }
      await tx.update(restaurantsTable).set({
        outreachStatus: storedStatus,
        ...(newStatus === StatusMap.CLOSED ? {
          suppressedAt: new Date(),
          suppressionReason: "closed",
          publicBusinessEmail: null,
        } : {}),
      }).where(eq(restaurantsTable.placeId, placeId));
      await tx.insert(outreachAuditTable).values({
        placeId,
        event: "status_updated",
        detail: JSON.stringify({ from: row.outreachStatus, to: storedStatus }),
      });
      return { id: placeId, status: newStatus, changed: true };
    });
    logEvent("info", result.changed ? `Workflow status updated: ${newStatus}` : "Workflow status already current");
    return result;
  } catch {
    logEvent("error", "Restaurant status update failed or transition was blocked");
    throw new Error("Status update failed: restaurant missing, transition protected, or database unavailable.");
  }
}

export async function setInitialStatus(restaurantId: string) {
  return updateStatus(restaurantId, StatusMap.NOT_CONTACTED);
}

/** Read-only, paginated lookup using workflow labels and real schema fields. */
export async function getRestaurantsByStatus(
  status: string,
  options: { limit?: number; offset?: number } = {},
) {
  if (!isValidStatus(status)) throw new Error("Invalid workflow status.");
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000
    || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Status lookup requires a limit of 1–1000 and a non-negative offset.");
  }
  if (status === StatusMap.SCRAPED || status === StatusMap.INSERTED) {
    throw new Error("Scraped and inserted are operational milestones, not stored outreach states.");
  }
  const stored = {
    not_contacted: ["pending"],
    contacted: ["sent"],
    followup_sent: ["followup_sent"],
    final_followup_sent: ["final_followup_sent"],
    engaged: ["interested", "upgrade"],
    awaiting_followup: ["question"],
    unknown_reply: ["replied"],
    error: ["send_failed"],
    closed: ["suppressed"],
  }[status];
  const condition = status === StatusMap.CLOSED
    ? or(isNotNull(restaurantsTable.suppressedAt), eq(restaurantsTable.outreachStatus, "suppressed"))
    : and(
        isNull(restaurantsTable.suppressedAt),
        ne(restaurantsTable.outreachStatus, "suppressed"),
        inArray(restaurantsTable.outreachStatus, stored),
      );
  try {
    return await db.select().from(restaurantsTable).where(condition)
      .orderBy(restaurantsTable.placeId).limit(limit).offset(offset);
  } catch {
    logEvent("error", "Restaurant status lookup failed");
    throw new Error("Restaurants could not be fetched by status; retry later.");
  }
}