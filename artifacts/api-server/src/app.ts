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
import { logger } from "./lib/logger";
import { instantlyWebhookRouter } from "./outreach/instantlyWebhook";

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
