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
  const { name, city, tone } = input;
  const subjects: Record<OutreachTone, string> = {
    premium: `A quick idea for ${name} in ${city}`,
    professional: `Opportunity for ${name} (${city})`,
    friendly: `A free basic listing for ${name}`,
    casual: `Quick question about ${name}`,
  };
  const introductions: Record<OutreachTone, string> = {
    friendly: `I came across ${name} while exploring places in ${city} and wanted to introduce The Food Advisor.`,
    professional: `I’m reaching out to introduce The Food Advisor to the team at ${name} in ${city}.`,
    premium: `I’d like to introduce a listing opportunity for ${name} in ${city}.`,
    casual: `I came across ${name} in ${city} and wanted to drop you a quick message.`,
  };
  const observation = input.cuisine
    ? `A listing can help diners looking for ${input.cuisine} restaurants discover your business.`
    : "A listing can help diners discover your restaurant.";
  const cta = "Would you like more information about a free basic listing? Just reply to this email.";
  return {
    subject: subjects[tone],
    body: [
      `Hi ${name} team,`,
      "",
      introductions[tone],
      "",
      observation,
      "",
      "I run The Food Advisor — a directory helping diners discover restaurants across the UK. A basic listing is free. Verification is optional and costs £99 GBP per month; you do not need to subscribe to have a basic listing.",
      "",
      cta,
      "",
      "Best wishes,",
      "Stuart",
      "The Food Advisor",
    ].join("\r\n"),
    cta,
  };
}