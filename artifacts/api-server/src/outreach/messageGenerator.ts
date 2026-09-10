import { z } from "zod";
import { logEvent } from "../utils/eventLog";
import { buildTemplate } from "./messageTemplates";
import { analyzeTone } from "./toneAnalyzer";

const singleLine = (maximum: number) => z.string().trim().min(1).max(maximum)
  .refine((value) => !/[\r\n\u0000-\u001f\u007f]/.test(value), "Expected single-line text");
const inputSchema = z.object({
  placeId: singleLine(512).optional(),
  id: singleLine(512).optional(),
  name: singleLine(500),
  city: singleLine(200),
  cuisine: singleLine(100).optional(),
  tone: z.enum(["friendly", "professional", "premium", "casual"]).optional(),
  brandingQuality: singleLine(50).optional(),
});

/**
 * Generates an unsent plain-text draft only. Does not mutate the input, write
 * the database, or contact Gmail. Sending must still go through the guarded
 * outreach service, including its unsubscribe mechanism and daily limit.
 */
export async function generateOutreachFor(restaurant: unknown) {
  logEvent("info", "Outreach generation started");
  try {
    const parsed = inputSchema.safeParse(restaurant);
    if (!parsed.success) throw new Error("Invalid outreach input.");
    const input = parsed.data;
    const tone = input.tone ?? analyzeTone(input);
    const message = buildTemplate({ ...input, tone });
    const outreach = {
      restaurantId: input.placeId ?? input.id ?? null,
      subject: message.subject,
      body: message.body,
      tone,
      cta: message.cta,
      generatedAt: new Date().toISOString(),
    };
    logEvent("success", "Outreach draft generated");
    return outreach;
  } catch {
    logEvent("error", "Outreach generation failed");
    throw new Error("Outreach draft could not be generated; check the restaurant details.");
  }
}