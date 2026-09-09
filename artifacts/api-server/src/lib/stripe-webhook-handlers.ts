import { getStripeSync } from "./stripe-client";

export class StripeWebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "Stripe webhook payload must be a Buffer. Ensure this route is registered before express.json().",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }
}