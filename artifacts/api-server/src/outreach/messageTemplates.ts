import type { OutreachTone } from "./toneAnalyzer";

export interface TemplateInput {
  name: string;
  city: string;
  cuisine?: string;
  website?: string;
  brandingQuality?: string;
  tone: OutreachTone;
}

export function buildTemplate(input: TemplateInput) {
  const cta = "Reply to this email if you would like more information about claiming your listing.";
  return {
    subject: `A listing opportunity for ${input.name}`,
    body: [
      `${input.tone === "professional" ? "Hello" : "Hi"} ${input.name} team,`,
      "",
      "The Food Advisor helps diners discover independent restaurants across the UK.",
      `We would like to introduce our listing service to your team in ${input.city}.`,
      "You can claim your listing and subscribe for £99 GBP per month.",
      "",
      cta,
      "",
      "The Food Advisor",
    ].join("\r\n"),
    cta,
  };
}