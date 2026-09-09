import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { StripeWebhookHandlers } from "./lib/stripe-webhook-handlers";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (typeof sig !== "string" || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid Stripe webhook request" });
      return;
    }

    try {
      await StripeWebhookHandlers.processWebhook(req.body, sig);
      res.status(200).json({ received: true });
    } catch {
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
