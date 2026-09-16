import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import pinoHttp from "pino-http";
import router from "./routes";
import aiRoutes, { aiAutomationRouter } from "./routes/ai";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import statusRoutes from "./routes/status";
import dashboardRoutes from "./routes/dashboard";
import dashboardOutreachRoutes from "./routes/dashboardOutreach";
import dashboardSchedulerRoutes from "./routes/dashboardScheduler";
import dashboardAIUsage from "./routes/dashboardAIUsage";
import dashboardClaims from "./routes/dashboardClaims";
import dashboardGlobal from "./routes/dashboardGlobal";
import dashboardTestOutreach from "./routes/dashboardTestOutreach";
import dashboardLeadQualification from "./routes/dashboardLeadQualification";
import dashboardFollowups from "./routes/dashboardFollowups";
import dashboardEscalation from "./routes/dashboardEscalation";
import dashboardPremium from "./routes/dashboardPremium";
import { logger } from "./lib/logger";
import { instantlyWebhookRouter } from "./outreach/instantlyWebhook";
import { handleWebhook as handleStripeWebhook } from "./services/stripeService";

const app: Express = express();

// Replit forwards requests through one trusted proxy hop. This lets middleware
// such as express-rate-limit identify the real client without trusting an
// arbitrary chain supplied by the caller.
app.set("trust proxy", 1);

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
// Instantly webhook authentication/body limits are owned by this router and
// must run before the global JSON parser. Keep both documented aliases on the
// same handler; neither path registers a provider webhook or sends mail.
app.use("/api/webhooks", instantlyWebhookRouter);
app.use("/webhooks", instantlyWebhookRouter);
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const header = req.headers["stripe-signature"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature." });
      return;
    }
    try {
      await handleStripeWebhook(req.body as Buffer, signature);
      res.json({ received: true });
    } catch (error) {
      req.log.error({ err: error }, "Stripe webhook processing failed");
      res.status(400).json({ error: "Invalid Stripe webhook." });
    }
  },
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
app.use(
  session({
    name: "tfa_admin",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);
app.use("/ai", aiRoutes);
app.use("/automation", aiAutomationRouter);
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/status", statusRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/dashboard", dashboardOutreachRoutes);
app.use("/dashboard", dashboardSchedulerRoutes);
app.use("/dashboard", dashboardAIUsage);
app.use("/dashboard", dashboardClaims);
app.use("/dashboard", dashboardGlobal);
app.use("/dashboard", dashboardTestOutreach);
app.use("/dashboard", dashboardLeadQualification);
app.use("/dashboard", dashboardFollowups);
app.use("/dashboard", dashboardEscalation);
app.use("/dashboard", dashboardPremium);
// Generated clients use the shared /api base; both aliases use identical auth.
app.use("/api/dashboard", dashboardRoutes);

app.use(
  (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (
      req.path === "/api/gmail/push" &&
      typeof error === "object" &&
      error !== null &&
      ("status" in error || error instanceof SyntaxError)
    ) {
      res.status(400).json({ error: "Invalid Pub/Sub request." });
      return;
    }
    next(error);
  },
);

export default app;
