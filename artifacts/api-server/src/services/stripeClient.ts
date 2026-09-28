import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { ReplitConnectors } from "@replit/connectors-sdk";
import Stripe from "stripe";
import {
  runMigrations,
  StripeSync,
  type Logger,
} from "stripe-replit-sync";
import {
  getPremiumPriceId,
  stripeKeyLivemode,
} from "../lib/premium-price";

export { getPremiumPriceId };

const connectors = new ReplitConnectors();
const execFileAsync = promisify(execFile);
const STRIPE_API_BASE_URL = "https://api.stripe.com";
const PREMIUM_AMOUNT = 9_900;
const PREMIUM_CURRENCY = "gbp";

interface StripeErrorEnvelope {
  error?: { message?: string };
}

interface StripeCredentials {
  secretKey: string;
  webhookSecret?: string;
}

interface ConnectorResponse {
  items?: Array<{
    environment?: string;
    status?: string;
    disabled?: boolean;
    settings?: {
      secret_key?: string;
      secret?: string;
      webhook_secret?: string;
    };
  }>;
}

// A webhook burst should not cause one connector request per event (or per
// verification/sync step). Never retain a rejected lookup or an old key for
// more than a minute, so rotations and disconnections are picked up promptly.
const CREDENTIAL_TTL_MS = 60_000;
let cachedCredentials: { value: StripeCredentials; expiresAt: number } | undefined;
let credentialLookup: Promise<StripeCredentials> | undefined;

function databaseUrl(): string {
  const value = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "NEON_DATABASE_URL or DATABASE_URL is required for Stripe sync.",
    );
  }
  return value;
}

function connectorBaseUrl(): string {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error(
      "Stripe integration is unavailable: REPLIT_CONNECTORS_HOSTNAME is missing.",
    );
  }
  return hostname.startsWith("http://") || hostname.startsWith("https://")
    ? hostname
    : `https://${hostname}`;
}

async function connectorAuthHeaders(): Promise<Record<string, string>> {
  if (process.env.REPL_IDENTITY) {
    return { "X-Replit-Token": `repl ${process.env.REPL_IDENTITY}` };
  }
  if (process.env.WEB_REPL_RENEWAL) {
    return { "X-Replit-Token": `depl ${process.env.WEB_REPL_RENEWAL}` };
  }

  const audience =
    process.env.REPLIT_CONNECTORS_AUDIENCE ?? "https://connectors.replit.com";
  const { stdout } = await execFileAsync(
    process.env.REPLIT_CLI ?? "replit",
    ["identity", "create", "--audience", audience],
    { timeout: 10_000 },
  );
  const token = stdout.trim();
  if (!token) throw new Error("Could not create a Replit identity token.");
  return { "Replit-Authentication": `Bearer ${token}` };
}

async function fetchConnectorCredentials(): Promise<StripeCredentials> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(
      `${connectorBaseUrl()}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      {
        headers: {
          Accept: "application/json",
          ...(await connectorAuthHeaders()),
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status !== 429 || attempt === 2) break;
    // Honor short Retry-After values, but never hold a webhook indefinitely.
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 3_000)
      : (attempt + 1) * 1_000;
    await sleep(delay);
  }
  if (!response) throw new Error("Stripe credential lookup did not return a response.");
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as ConnectorResponse;
  const expectedEnvironment =
    process.env.REPLIT_DEPLOYMENT === "1" ||
    !!process.env.WEB_REPL_RENEWAL ||
    process.env.NODE_ENV === "production"
      ? "production"
      : "development";
  const connection = body.items?.find(
    (item) =>
      item.environment === expectedEnvironment &&
      item.status !== "disconnected" &&
      !item.disabled,
  );
  const settings = connection?.settings;
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error(
      "Stripe integration is not connected or did not provide a secret key.",
    );
  }
  return {
    secretKey,
    webhookSecret: settings?.webhook_secret,
  };
}

async function getStripeCredentials(): Promise<StripeCredentials> {
  const externalSecretKey = process.env.STRIPE_SECRET_KEY;
  if (externalSecretKey) {
    return {
      secretKey: externalSecretKey,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    };
  }

  if (cachedCredentials && Date.now() < cachedCredentials.expiresAt) {
    return cachedCredentials.value;
  }
  if (!credentialLookup) {
    credentialLookup = fetchConnectorCredentials()
      .then((value) => {
        cachedCredentials = { value, expiresAt: Date.now() + CREDENTIAL_TTL_MS };
        return value;
      })
      .finally(() => {
        credentialLookup = undefined;
      });
  }
  return credentialLookup;
}

export async function stripeRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    form?: URLSearchParams;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers = {
    ...(options.form
      ? { "Content-Type": "application/x-www-form-urlencoded" }
      : {}),
    ...(options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : {}),
  };
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const response = secretKey
    ? await fetch(`${STRIPE_API_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        ...(options.form ? { body: options.form } : {}),
        headers: {
          ...headers,
          Authorization: `Bearer ${secretKey}`,
        },
      })
    : await connectors.proxy("stripe", path, {
        method: options.method ?? "GET",
        ...(options.form ? { body: options.form } : {}),
        headers,
      });
  if (!response.ok) {
    let message = `Stripe request failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as StripeErrorEnvelope;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Keep the status-only error when Stripe did not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey, { maxNetworkRetries: 2 });
}

export async function getPremiumStripeClient(): Promise<{
  stripe: Stripe;
  livemode: boolean;
}> {
  const { secretKey } = await getStripeCredentials();
  const livemode = stripeKeyLivemode(secretKey);
  if (
    (process.env.REPLIT_DEPLOYMENT === "1" ||
      !!process.env.WEB_REPL_RENEWAL ||
      process.env.NODE_ENV === "production") &&
    !livemode
  ) {
    throw new Error("Production Premium checkout requires live Stripe credentials.");
  }
  return {
    stripe: new Stripe(secretKey, { maxNetworkRetries: 2 }),
    livemode,
  };
}

export async function getStripeSync(): Promise<StripeSync> {
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: {
      connectionString: databaseUrl(),
      ssl: process.env.NEON_DATABASE_URL
        ? { rejectUnauthorized: true }
        : undefined,
    },
    stripeSecretKey: secretKey,
    ...(webhookSecret ? { stripeWebhookSecret: webhookSecret } : {}),
    revalidateObjectsViaStripeApi: ["subscription", "price", "product"],
  });
}

export async function closeStripeSync(sync: StripeSync): Promise<void> {
  await sync.postgresClient.pool.end();
}

async function managedWebhookSecret(
  sync: StripeSync,
  webhookUrl: string,
): Promise<string | null> {
  const accountId = await sync.getAccountId();
  const result = await sync.postgresClient.query(
    `SELECT secret
       FROM "stripe"."_managed_webhooks"
      WHERE account_id = $1
        AND url = $2
      LIMIT 1`,
    [accountId, webhookUrl],
  );
  const secret = result.rows[0]?.secret;
  return typeof secret === "string" && secret.length > 0 ? secret : null;
}

export async function verifyStripeEvent(
  payload: Buffer,
  signature: string,
): Promise<Stripe.Event> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error("Stripe webhook payload must be a raw Buffer.");
  }
  if (!signature) throw new Error("Stripe webhook signature is required.");

  if (process.env.STRIPE_SECRET_KEY) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is required with STRIPE_SECRET_KEY.",
      );
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    return stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  }

  const sync = await getStripeSync();
  try {
    const webhookSecret = await managedWebhookSecret(sync, managedWebhookUrl());
    if (!webhookSecret) {
      throw new Error(
        "Stripe managed webhook signing secret is unavailable; initialize the exact webhook URL first.",
      );
    }
    const stripe = await getUncachableStripeClient();
    return stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
    );
  } finally {
    await closeStripeSync(sync);
  }
}

function webhookBaseUrl(): string {
  const hostname =
    process.env.REPLIT_DEPLOYMENT === "1" ||
    !!process.env.WEB_REPL_RENEWAL ||
    process.env.NODE_ENV === "production" ||
    (process.env.STRIPE_SECRET_KEY
      ? stripeKeyLivemode(process.env.STRIPE_SECRET_KEY)
      : false)
      ? process.env.REPLIT_DOMAINS?.split(",")[0]
      : process.env.REPLIT_DEV_DOMAIN ??
        process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!hostname) {
    throw new Error("A Replit domain is required to configure Stripe webhooks.");
  }
  return `https://${hostname}`;
}

function managedWebhookUrl(): string {
  return `${webhookBaseUrl()}/api/stripe/webhook`;
}

/** Read-only release probe. Never creates a customer, checkout session, or charge. */
export async function validatePremiumPrice(): Promise<void> {
  const { stripe, livemode } = await getPremiumStripeClient();
  const priceId = getPremiumPriceId(livemode);
  const price = await stripe.prices.retrieve(priceId);
  if (
    price.id !== priceId ||
    price.livemode !== livemode ||
    !price.active ||
    price.currency.toLowerCase() !== PREMIUM_CURRENCY ||
    price.unit_amount !== PREMIUM_AMOUNT ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1
  ) {
    throw new Error(
      "Premium price must be an active £99 GBP monthly Price for the current Stripe environment.",
    );
  }
}

let initialization: Promise<void> | undefined;

export function initializeStripe(): Promise<void> {
  initialization ??= (async () => {
    const url = databaseUrl();
    const logger: Logger = console;
    await runMigrations({
      databaseUrl: url,
      ssl: process.env.NEON_DATABASE_URL
        ? { rejectUnauthorized: true }
        : undefined,
      logger,
    });
    await validatePremiumPrice();
    const sync = await getStripeSync();
    try {
      await sync.findOrCreateManagedWebhook(managedWebhookUrl(), {
        enabled_events: sync.getSupportedEventTypes(),
        description: "The Food Advisor Stripe sync",
        metadata: {
          app: "the-food-advisor",
          managed_by: "stripe-sync",
        },
      });
      await sync.syncBackfill();
    } finally {
      await closeStripeSync(sync);
    }
  })();
  return initialization;
}