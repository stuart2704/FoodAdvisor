import { db, externalCandidatesTable, osmCandidateWorkflowsTable, osmClaimInvitesTable, osmOutreachLogsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { GmailHttpError, sendGmailPlainText } from "./gmail/gmailClient";
import {
  autoInviteEligibility, CLAIM_INVITE_TTL_MS, createOpaqueToken, hashOpaqueSecret,
  MAX_CLAIM_INVITES, MIN_INVITE_INTERVAL_MS, OSM_SOURCE, safeProviderErrorCode, validBusinessEmail,
} from "./osmCandidateWorkflow";
import { logger } from "../lib/logger";

export type InviteResult = { status: "sent" | "failed" | "unknown" | "ineligible"; id?: number; sentTo?: string };

/**
 * A committed reservation is deliberately not reclaimed. A process crash, timeout,
 * or lost acknowledgement can mean Gmail accepted the message: human review is
 * required before attempting another delivery.
 */
export async function sendOsmInvite(sourceId: string, requestedEmail?: string, automatic = false): Promise<InviteResult> {
  if (process.env.NODE_ENV !== "production") throw new Error("Claim invitations require the published claim flow.");
  if (automatic && process.env.OSM_CLAIM_AUTO_INVITES_ENABLED !== "true") {
    return { status: "ineligible" };
  }
  const now = new Date();
  const rawToken = createOpaqueToken();
  const tokenHash = hashOpaqueSecret(rawToken);
  const reservation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OSM_SOURCE}), hashtext(${sourceId}))`);
    const [workflow] = await tx.select().from(osmCandidateWorkflowsTable).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
      eq(osmCandidateWorkflowsTable.sourceId, sourceId),
    )).limit(1);
    if (!workflow || !workflow.reviewed || !workflow.highConfidence || workflow.suppressed
      || workflow.published || workflow.claimed || workflow.outreachBlocked || workflow.inviteCount >= MAX_CLAIM_INVITES) return null;
    const [candidate] = await tx.select().from(externalCandidatesTable).where(and(
      eq(externalCandidatesTable.sourceName, OSM_SOURCE),
      eq(externalCandidatesTable.sourceId, sourceId),
    )).limit(1);
    if (!candidate) return null;
    const [latest] = await tx.select().from(osmClaimInvitesTable).where(and(
      eq(osmClaimInvitesTable.sourceName, OSM_SOURCE),
      eq(osmClaimInvitesTable.sourceId, sourceId),
    )).orderBy(desc(osmClaimInvitesTable.createdAt), desc(osmClaimInvitesTable.id)).limit(1);
    if (latest && ["reserved", "unknown"].includes(latest.status)) return null;
    if (latest && now.getTime() - latest.createdAt.getTime() < MIN_INVITE_INTERVAL_MS) return null;
    if (automatic && autoInviteEligibility(workflow, latest, now).status !== "due") return null;
    const recipient = (automatic ? workflow.approvedContactEmail : requestedEmail ?? latest?.sentTo)?.trim().toLowerCase();
    if (!recipient || !validBusinessEmail(recipient)) return null;
    const [invite] = await tx.insert(osmClaimInvitesTable).values({
      sourceName: OSM_SOURCE, sourceId, tokenHash, sentTo: recipient, method: "email",
      status: "reserved", createdAt: now, expiresAt: new Date(now.getTime() + CLAIM_INVITE_TTL_MS),
    }).returning({ id: osmClaimInvitesTable.id });
    if (!invite) throw new Error("Invite reservation was not persisted.");
    await tx.update(osmCandidateWorkflowsTable).set({
      inviteCount: workflow.inviteCount + 1, updatedAt: now,
    }).where(and(
      eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
      eq(osmCandidateWorkflowsTable.sourceId, sourceId),
    ));
    return { id: invite.id, sentTo: recipient, name: candidate.rawName };
  });
  if (!reservation) return { status: "ineligible" };

  let status: "sent" | "failed" | "unknown" = "sent";
  let errorCode: string | null = null;
  try {
    await sendGmailPlainText({
      to: reservation.sentTo,
      subject: "A secure claim invitation for your restaurant listing",
      body: [
        "Hello,", "",
        `The Food Advisor has a restaurant listing for ${reservation.name}.`,
        "If you are authorised to manage this business, use the secure, single-use link below to begin the review process.",
        "",
        `https://www.thefoodadvisor.co.uk/claim/${encodeURIComponent(sourceId)}/${encodeURIComponent(rawToken)}`,
        "",
        "The link expires in 48 hours. Email verification confirms control of this email address only; ownership and source-rights evidence are reviewed separately.",
        "", "The Food Advisor",
      ].join("\r\n"),
    });
  } catch (error) {
    status = error instanceof GmailHttpError && error.status < 500 ? "failed" : "unknown";
    errorCode = safeProviderErrorCode(error);
    logger.warn({ sourceId, inviteId: reservation.id, errorCode }, "OSM claim invitation delivery failed");
  }
  // If persistence fails, the reserved row still blocks another attempt.
  await db.transaction(async (tx) => {
    const deliveredAt = status === "sent" ? new Date() : null;
    await tx.update(osmClaimInvitesTable).set({ status, providerSentAt: deliveredAt })
      .where(eq(osmClaimInvitesTable.id, reservation.id));
    await tx.insert(osmOutreachLogsTable).values({
      sourceName: OSM_SOURCE, sourceId, inviteId: reservation.id, sentTo: reservation.sentTo,
      method: "email", status, errorCode, createdAt: new Date(),
    });
    if (status === "sent") {
      await tx.update(osmCandidateWorkflowsTable).set({
        state: "claim_invited", updatedAt: deliveredAt ?? new Date(),
      }).where(and(
        eq(osmCandidateWorkflowsTable.sourceName, OSM_SOURCE),
        eq(osmCandidateWorkflowsTable.sourceId, sourceId),
        eq(osmCandidateWorkflowsTable.suppressed, false),
        eq(osmCandidateWorkflowsTable.published, false),
        eq(osmCandidateWorkflowsTable.claimed, false),
      ));
    }
  });
  return { status, id: reservation.id, sentTo: reservation.sentTo };
}