import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logEvent as recordEvent } from "../utils/eventLog.ts";
import {
  hasValidInstantlyWebhookSecret,
  instantlyWebhookConfigured,
  instantlyWebhookEnabled,
  INSTANTLY_REPLY_RECEIVED_EVENT,
  parseInstantlyWebhookPayload,
} from "./instantlyWebhookContracts.ts";

const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const instantlyWebhookRateLimit = rateLimit({
  windowMs: 60 * 1_000,
  max: 60,
  message: { error: "Too many Instantly webhook requests." },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

interface ReconcileResult {
  processed: number;
  skipped: number;
  failed: number;
}

type ReconcileInstantlyInbox = () => Promise<ReconcileResult>;

async function reconcileViaInstantlyService(): Promise<ReconcileResult> {
  const service = await import("../services/instantly/instantlyService.ts");
  return service.reconcileInstantlyInboxFully();
}

function jsonError(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function logEvent(message: string): void {
  recordEvent("info", message);
}

function logError(message: string, category: string): void {
  recordEvent("error", message, category);
}

/**
 * Authentication is deliberately a route middleware so it runs before the
 * rate limiter and, more importantly, before any provider reconciliation or
 * database query.
 */
export const authenticateInstantlyWebhook: RequestHandler = (req, res, next): void => {
  if (!instantlyWebhookConfigured()) {
    jsonError(res, 503, "Instantly webhook authentication is not configured.");
    return;
  }
  if (!instantlyWebhookEnabled()) {
    jsonError(res, 404, "Instantly webhook is disabled.");
    return;
  }
  if (!hasValidInstantlyWebhookSecret(req.headers)) {
    jsonError(res, 401, "Invalid Instantly webhook credential.");
    return;
  }
  next();
};

function bodyParserError(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (typeof error !== "object" || error === null) {
    next(error);
    return;
  }
  const candidate = error as { type?: unknown; status?: unknown };
  if (
    candidate.type === "entity.too.large"
    || candidate.status === 413
  ) {
    jsonError(res, 413, "Instantly webhook body is too large.");
    return;
  }
  if (error instanceof SyntaxError || candidate.type === "entity.parse.failed") {
    jsonError(res, 400, "Invalid Instantly webhook body.");
    return;
  }
  next(error);
}

/**
 * This handler intentionally does not read a restaurant ID, subject,
 * custom-variable, or status field from the webhook. The payload is only a
 * delivery hint. A successful hint causes the existing authenticated,
 * paginated inbox reconciliation to fetch provider messages, verify the
 * durable campaign ownership mapping, and reserve message IDs transactionally.
 */
export function createInstantlyWebhookHandler(
  reconcile: ReconcileInstantlyInbox = reconcileViaInstantlyService,
): RequestHandler {
  return async (req, res): Promise<void> => {
    const payload = parseInstantlyWebhookPayload(req.body);
    if (!payload) {
      jsonError(res, 400, "Invalid Instantly webhook payload.");
      return;
    }

    // Webhooks may be configured for all events. Only a documented reply event
    // can change local reply state; all other valid events are safely ignored.
    if (payload.eventType !== INSTANTLY_REPLY_RECEIVED_EVENT) {
      res.status(204).end();
      return;
    }

    try {
      const result = await reconcile();
      if (result.failed > 0) {
        throw new Error("Instantly inbox reconciliation was incomplete.");
      }
      logEvent("Instantly reply webhook reconciled.");
      res.status(204).end();
    } catch {
      // A non-2xx response is intentional: Instantly must retry the hint
      // instead of treating a provider/database failure as delivered.
      logError("Instantly reply webhook reconciliation failed.", "webhook_error");
      jsonError(res, 503, "Instantly webhook processing is temporarily unavailable.");
    }
  };
}

export const instantlyWebhookRouter = express.Router();

instantlyWebhookRouter.use(
  express.json({
    limit: `${MAX_WEBHOOK_BODY_BYTES}b`,
    strict: true,
  }),
);
instantlyWebhookRouter.use(bodyParserError);

instantlyWebhookRouter.post(
  "/instantly",
  authenticateInstantlyWebhook,
  instantlyWebhookRateLimit,
  createInstantlyWebhookHandler(),
);