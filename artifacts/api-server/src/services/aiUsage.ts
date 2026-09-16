import { aiUsageEventsTable, db } from "@workspace/db";

export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface TokenPricing {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

// Standard API pricing verified from OpenAI's official pricing page.
const PRICING: Array<[modelPrefix: string, pricing: TokenPricing]> = [
  [
    "gpt-5-mini",
    {
      inputPerMillionUsd: 0.25,
      cachedInputPerMillionUsd: 0.025,
      outputPerMillionUsd: 2,
    },
  ],
  [
    "gpt-5-nano",
    {
      inputPerMillionUsd: 0.05,
      cachedInputPerMillionUsd: 0.005,
      outputPerMillionUsd: 0.4,
    },
  ],
  [
    "gpt-5",
    {
      inputPerMillionUsd: 1.25,
      cachedInputPerMillionUsd: 0.125,
      outputPerMillionUsd: 10,
    },
  ],
];

function pricingFor(model: string): TokenPricing | null {
  return PRICING.find(([prefix]) => model.startsWith(prefix))?.[1] ?? null;
}

export async function recordAiUsage(
  endpoint: string,
  model: string,
  usage: OpenAiUsage | undefined,
): Promise<void> {
  if (!usage) return;
  const inputTokens = Math.max(0, usage.prompt_tokens ?? 0);
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, usage.prompt_tokens_details?.cached_tokens ?? 0),
  );
  const outputTokens = Math.max(0, usage.completion_tokens ?? 0);
  const totalTokens = Math.max(
    inputTokens + outputTokens,
    usage.total_tokens ?? 0,
  );
  const pricing = pricingFor(model);
  const estimatedCostUsd = pricing
    ? ((inputTokens - cachedInputTokens) * pricing.inputPerMillionUsd +
        cachedInputTokens * pricing.cachedInputPerMillionUsd +
        outputTokens * pricing.outputPerMillionUsd) /
      1_000_000
    : 0;

  await db.insert(aiUsageEventsTable).values({
    endpoint,
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    estimatedCostMicros: Math.round(estimatedCostUsd * 1_000_000),
  });
}