import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

interface StripeErrorEnvelope {
  error?: { message?: string };
}

export async function stripeRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    form?: URLSearchParams;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const response = await connectors.proxy("stripe", path, {
    method: options.method ?? "GET",
    ...(options.form ? { body: options.form } : {}),
    headers: {
      ...(options.form
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
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

export async function initializeStripe(): Promise<void> {
  const connections = await connectors.listConnections({
    connector_names: "stripe",
    refresh_policy: "auto",
  });
  if (!connections.some((connection) => connection.status !== "disconnected")) {
    throw new Error("Stripe integration is not connected.");
  }
}