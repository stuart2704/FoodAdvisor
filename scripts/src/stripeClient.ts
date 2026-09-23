import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Stripe from "stripe";

const execFileAsync = promisify(execFile);

interface ConnectorResponse {
  items?: Array<{
    environment?: string;
    status?: string;
    disabled?: boolean;
    settings?: { secret_key?: string; secret?: string };
  }>;
}

async function getStripeSecretKey(): Promise<string> {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  if (!hostname) {
    throw new Error(
      "Stripe integration is unavailable: REPLIT_CONNECTORS_HOSTNAME is missing.",
    );
  }
  let authHeaders: Record<string, string>;
  if (process.env.REPL_IDENTITY) {
    authHeaders = {
      "X-Replit-Token": `repl ${process.env.REPL_IDENTITY}`,
    };
  } else if (process.env.WEB_REPL_RENEWAL) {
    authHeaders = {
      "X-Replit-Token": `depl ${process.env.WEB_REPL_RENEWAL}`,
    };
  } else {
    const audience =
      process.env.REPLIT_CONNECTORS_AUDIENCE ??
      "https://connectors.replit.com";
    const { stdout } = await execFileAsync(
      process.env.REPLIT_CLI ?? "replit",
      ["identity", "create", "--audience", audience],
      { timeout: 10_000 },
    );
    const token = stdout.trim();
    if (!token) throw new Error("Could not create a Replit identity token.");
    authHeaders = { "Replit-Authentication": `Bearer ${token}` };
  }

  const baseUrl =
    hostname.startsWith("http://") || hostname.startsWith("https://")
      ? hostname
      : `https://${hostname}`;
  const response = await fetch(
    `${baseUrl}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", ...authHeaders },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as ConnectorResponse;
  const expectedEnvironment =
    process.env.NODE_ENV === "production" ? "production" : "development";
  const connection = body.items?.find(
    (item) =>
      item.environment === expectedEnvironment &&
      item.status !== "disconnected" &&
      !item.disabled,
  );
  const secretKey =
    connection?.settings?.secret_key ?? connection?.settings?.secret;
  if (!secretKey) throw new Error("Stripe integration is not connected.");
  return secretKey;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  return new Stripe(await getStripeSecretKey());
}