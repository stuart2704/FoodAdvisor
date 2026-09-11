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
    case "upgrade_request":
      return {
        subject: "About upgrading your listing",
        body: [
          greeting,
          "Thanks for asking about an upgrade.",
          offer,
          "There is no paid upgrade link available at present. If you would like to proceed with a free basic listing, please let me know.",
          signature,
        ].join("\n\n"),
      };
    case "menu_request":
      return {
        subject: "Your restaurant menu",
        body: [
          greeting,
          "Thanks for asking about menus. Please share a link to your current menu and let me know which menu details you would like included.",
          "I’ll review what can be added and confirm the setup and timing before publication.",
          offer,
          signature,
        ].join("\n\n"),
      };
    case "app_question":
      return {
        subject: "About The Food Advisor app",
        body: [
          greeting,
          "The Food Advisor is a restaurant discovery directory with a companion mobile app planned.",
          "Please let me know what you would like to know about the app. I’ll confirm availability and supported listing features before sharing any setup instructions.",
          offer,
          signature,
        ].join("\n\n"),
      };
    case "positive":
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
    case "followup":
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
    case "negative":
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