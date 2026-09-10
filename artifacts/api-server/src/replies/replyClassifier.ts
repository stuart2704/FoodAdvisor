import { classifyReply, type ReplyIntent } from "./classifier";

export type ReplyIntentLabel = "positive" | "negative" | "followup" | "unclear";

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
  return toReplyIntentLabel(classifyReply(body));
}