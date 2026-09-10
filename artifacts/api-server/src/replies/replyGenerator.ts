import type { ReplyIntent } from "./classifier";

export interface ReplyContext {
  restaurantName?: string;
}

export interface ReplyDraft {
  subject: string;
  body: string;
}

/**
 * Deterministic plain-text drafts, not an AI model or an email sender.
 * Review before sending; suppression and out-of-office rules still apply.
 */
export function generateReplyMessage(intent: ReplyIntent | string, reply: ReplyContext): ReplyDraft {
  const name = typeof reply?.restaurantName === "string"
    ? reply.restaurantName.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500)
    : "";
  const greeting = name ? `Hi ${name} team,` : "Hello,";
  const signature = "Best wishes,\nStuart\nThe Food Advisor";
  const offer = "A basic listing is free. Paid verification is currently unavailable, and no subscription is needed for a basic listing.";
  switch (intent) {
    case "interested":
      return {
        subject: "Great to hear from you — next steps",
        body: [
          greeting,
          "Thanks so much for getting back to me — that’s great to hear.",
          offer,
          "To help prepare your basic listing, please confirm your preferred business contact email. You can also share a short restaurant description and any photos you have permission to use, if you wish.",
          "I’ll confirm the next steps and timing before publication.",
          signature,
        ].join("\n\n"),
      };
    case "questions":
      return {
        subject: "Happy to explain how it works",
        body: [
          greeting,
          "Thanks for your message — happy to explain.",
          "The Food Advisor is a restaurant directory helping diners discover restaurants across the UK.",
          offer,
          "Please let me know which details you would like clarified, and I’ll help.",
          signature,
        ].join("\n\n"),
      };
    case "not_interested":
      return {
        subject: "Thanks for letting me know",
        body: [
          greeting,
          "Thanks for getting back to me — I appreciate you letting me know.",
          "Wishing you and your team all the best.",
          signature,
        ].join("\n\n"),
      };
    default:
      return {
        subject: "Quick clarification",
        body: [
          greeting,
          "Thanks for your message — could you clarify what you’d like to do or what information you need?",
          "Happy to help.",
          signature,
        ].join("\n\n"),
      };
  }
}