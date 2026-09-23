import Stripe from "stripe";
import { StripeSync, runMigrations } from "stripe-replit-sync";

interface StripeConnectionResponse {
  items?: Array<{
    environment?: string;
    status?: string;
    connector_name?: string;
    settings?: {
      secret?: string;
      secret_key?: string;
    };
  }>;
}

function databaseConfig(): {
  databaseUrl: string;
  ssl?: { rejectUnauthorized: false };
} {
  const neonDatabaseUrl = process.env.NEON_DATABASE_URL;
  const databaseUrl = neonDatabaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("NEON_DATABASE_URL or DATABASE_URL must be configured.");
  }
  return {
    databaseUrl,
    ...(neonDatabaseUrl ? { ssl: { rejectUnauthorized: false as const } } : {}),
  };
}

async function getStripeCredentials(): Promise<{
  secretKey: string;
}> {
  if (process.env.STRIPE_SECRET_KEY) {
    return { secretKey: process.env.STRIPE_SECRET_KEY };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !replitToken) {
    throw new Error(
      "Stripe integration credentials are unavailable. Connect Stripe through Replit Integrations.",
    );
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: replitToken,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Stripe integration credentials could not be loaded (${response.status}).`,
    );
  }

  const body = (await response.json()) as StripeConnectionResponse;
  const expectedEnvironment =
    process.env.NODE_ENV === "production" ? "production" : "development";
  const connection = body.items?.find(
    (item) =>
      item.connector_name === "stripe" &&
      item.environment === expectedEnvironment &&
      item.status !== "disconnected",
  );
  if (!connection) {
    throw new Error(
      `A connected Stripe ${expectedEnvironment} environment is required.`,
    );
  }
  const settings = connection?.settings;
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error("The connected Stripe account did not provide a secret key.");
  }
  return { secretKey };
}

export function getPremiumPriceId(): string {
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new Error("STRIPE_PREMIUM_PRICE_ID is not configured.");
  }
  return priceId;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey, { maxNetworkRetries: 2 });
}

export async function getStripeSync(): Promise<StripeSync> {
  const { databaseUrl, ssl } = databaseConfig();
  const { secretKey } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: {
      connectionString: databaseUrl,
      ...(ssl ? { ssl } : {}),
    },
    stripeSecretKey: secretKey,
    revalidateObjectsViaStripeApi: [
      "subscription",
      "price",
      "product",
    ],
  });
}

export async function initializeStripe(): Promise<void> {
  const { databaseUrl, ssl } = databaseConfig();
  await runMigrations({
    databaseUrl,
    ...(ssl ? { ssl } : {}),
  });

  const stripeSync = await getStripeSync();
  const stripe = await getUncachableStripeClient();
  const price = await stripe.prices.retrieve(getPremiumPriceId());
  const expectedLiveMode = process.env.NODE_ENV === "production";
  if (
    price.livemode !== expectedLiveMode ||
    !price.active ||
    price.currency !== "gbp" ||
    price.unit_amount !== 9_900 ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    throw new Error(
      "STRIPE_PREMIUM_PRICE_ID must be the active £99 GBP monthly Price for the current Stripe environment.",
    );
  }
  const hostname = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!hostname) {
    throw new Error("REPLIT_DOMAINS is required to register the Stripe webhook.");
  }
  await stripeSync.findOrCreateManagedWebhook(
    `https://${hostname}/api/stripe/webhook`,
    {
      enabled_events: stripeSync.getSupportedEventTypes(),
      metadata: {
        app: "the-food-advisor",
        managed_by: "stripe-sync",
      },
    },
  );
  await stripeSync.syncBackfill({ object: "all" });
}