import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
// Stripe webhooks must always receive the exact bytes. Full processing remains
// intentionally fail-closed until stripe-replit-sync is installed/configured.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res) => {
    req.log.warn("Rejected Stripe webhook because sync is not configured");
    res.status(503).json({
      error:
        "Stripe webhook processing is not configured; no event was accepted.",
    });
  },
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
