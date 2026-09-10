import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import {
  getStripeDatabaseUrl,
  getStripeSync,
} from "./lib/stripe-client";
import {
  installStripeReconciliation,
  reconcileExistingStripeRows,
} from "./lib/stripe-reconciliation";
import { assertPublicHttpsUrl } from "./lib/public-url";
import { startWatchRenewal } from "./cron/watchRenewal";

async function initStripe(): Promise<void> {
  const databaseUrl = getStripeDatabaseUrl();
  await runMigrations({ databaseUrl });
  await installStripeReconciliation();
  const stripeSync = await getStripeSync();
  const publicUrl = await assertPublicHttpsUrl(process.env.PUBLIC_APP_URL, { canonical: true });
  const webhookUrl = `${publicUrl.origin}/api/stripe/webhook`;
  const enabled_events = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.payment_action_required",
    ] as const;
  const webhook = await stripeSync.findOrCreateManagedWebhook(webhookUrl, { enabled_events: [...enabled_events] });
  if (webhook.status !== "enabled" ||
      webhook.enabled_events.length !== enabled_events.length ||
      enabled_events.some((event) => !webhook.enabled_events.includes(event))) {
    await stripeSync.updateManagedWebhook(webhook.id, { enabled_events: [...enabled_events] });
  }

  await stripeSync.syncBackfill({ object: "product" });
  await stripeSync.syncBackfill({ object: "price" });
  await stripeSync.syncBackfill({ object: "checkout_sessions" });
  await stripeSync.syncBackfill({ object: "subscription" });
  await reconcileExistingStripeRows();
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startWatchRenewal();
});
