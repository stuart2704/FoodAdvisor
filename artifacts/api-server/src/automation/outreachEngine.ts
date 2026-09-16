import {
  runDailyCycle,
  type DailyCycleResult,
} from "../core/integration";
import { classifyReply } from "../services/replyClassifier/classifyReply";

export interface OutreachEngineResult extends DailyCycleResult {
  success: boolean;
}

export type OutreachReplyIntent =
  | "positive"
  | "negative"
  | "neutral"
  | "interested"
  | "not_interested";

export function classifyOutreachReply(replyText: string): {
  intent: OutreachReplyIntent;
} {
  const classification = classifyReply(replyText);
  switch (classification.category) {
    case "unsubscribe":
    case "not_interested":
      return { intent: "not_interested" };
    case "wrong_contact":
      return { intent: "negative" };
    case "interested":
      return { intent: "positive" };
    case "upgrade":
      return { intent: "interested" };
    default:
      return { intent: "neutral" };
  }
}

/**
 * Coordinates the existing guarded outreach services. Provider reconciliation,
 * claim and suppression barriers, staged-reply checks, daily delivery limits,
 * campaign cancellation, due-date rules, and database locking remain owned by
 * the underlying cycle and sender.
 */
export default async function outreachEngine(): Promise<OutreachEngineResult> {
  const result = await runDailyCycle({
    sendOutreach: true,
    sendFollowups: true,
  });
  const outreachFailed =
    result.outreach.status === "completed" &&
    result.outreach.result.failed > 0;
  const followupFailed =
    result.followups.status === "completed" &&
    result.followups.results.some((item) => item.failed > 0);
  return {
    ...result,
    success:
      result.status === "completed" && !outreachFailed && !followupFailed,
  };
}