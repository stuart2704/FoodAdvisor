import {
  classifyReply as classifyDetailedReply,
  type ReplyClassification,
} from "../services/replyClassifier/classifyReply";

export type ReplyIntent = "interested" | "not_interested" | "questions" | "unclear";

// Keep the detailed classification for suppression/pause decisions.
// This four-intent projection is for response generation, not status writes.
export function mapReplyIntent(classification: ReplyClassification): ReplyIntent {
  switch (classification.category) {
    case "unsubscribe":
    case "wrong_contact":
    case "not_interested":
      return "not_interested";
    case "upgrade":
      return "interested";
    case "interested":
      return classification.matchedPattern === "tell_me_more" ? "questions" : "interested";
    case "question":
      return "questions";
    default:
      return "unclear";
  }
}

export function classifyReply(text: string): ReplyIntent {
  if (typeof text !== "string" || !text.trim()) return "unclear";
  return mapReplyIntent(classifyDetailedReply(text));
}