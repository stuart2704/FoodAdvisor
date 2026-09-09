import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
};

/**
 * Fetch Stripe credentials from the Replit connection API.
 * This is intentionally uncached so rotated connector credentials are picked up.
 */
async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    items?: Array<{
      settings?: {
        secret?: string;
        secret_key?: string;
        webhook_secret?: string;
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;
  const secretKey = settings?.secret ?? settings?.secret_key;

  if (!secretKey) {
    throw new Error(
      "Stripe integration is not connected or is missing its secret key. Connect Stripe via the Integrations tab first.",
    );
  }

  return {
    secretKey,
    webhookSecret: settings?.webhook_secret,
  };
}

export function getStripeDatabaseUrl(): string {
  const databaseUrl =
    process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "NEON_DATABASE_URL or DATABASE_URL is required for Stripe integration.",
    );
  }
  return databaseUrl;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = getStripeDatabaseUrl();
  const { secretKey, webhookSecret } = await getStripeCredentials();

  return new StripeSync({
    poolConfig: {
      connectionString: databaseUrl,
      max: 5,
      ...(process.env.NEON_DATABASE_URL
        ? { ssl: { rejectUnauthorized: true } }
        : {}),
    },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
    backfillRelatedEntities: true,
    revalidateObjectsViaStripeApi: ["subscription"],
  });
}