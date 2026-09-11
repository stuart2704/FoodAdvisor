import { mapReplyIntent, type ReplyIntent } from "./classifier";
import { classifyReply } from "../services/replyClassifier/classifyReply";

export type ReplyIntentLabel = "positive" | "upgrade_request" | "menu_request" | "app_question" | "negative" | "followup" | "unclear";

export function toReplyIntentLabel(intent: ReplyIntent): ReplyIntentLabel {
  switch (intent) {
    case "interested": return "positive";
    case "not_interested": return "negative";
    case "questions": return "followup";
    default: return "unclear";
  }
}

/**
 * Compatibility labels over the shared classifier. Negative requests take
 * precedence, and substring matches such as "yes" in "yesterday" cannot opt in.
 */
export function classifyReplyIntent(body: string): ReplyIntentLabel {
  if (typeof body !== "string" || !body.trim()) return "unclear";
  const result = classifyReply(body);
  if (result.category === "upgrade") return "upgrade_request";
  if (result.matchedPattern === "menu_request") return "menu_request";
  if (result.matchedPattern === "app_question") return "app_question";
  if (["tell_me_more", "send_details", "more_info"].includes(result.matchedPattern ?? "")) return "positive";
  return toReplyIntentLabel(mapReplyIntent(result));
}