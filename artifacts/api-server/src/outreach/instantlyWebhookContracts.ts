import { createHash, timingSafeEqual } from "node:crypto";
import { validInstantlyProviderId } from "../services/instantly/instantlyContracts.ts";

export const INSTANTLY_WEBHOOK_ENABLED_ENV = "INSTANTLY_WEBHOOK_ENABLED";
export const INSTANTLY_WEBHOOK_SECRET_ENV = "INSTANTLY_WEBHOOK_SECRET";
export const INSTANTLY_WEBHOOK_HEADER_SECRET_ENV = "INSTANTLY_WEBHOOK_HEADER_SECRET";

export const INSTANTLY_REPLY_RECEIVED_EVENT = "reply_received";
export const MAX_INSTANTLY_WEBHOOK_TEXT_CHARS = 20_000;

const SECRET_MIN_LENGTH = 32;
const SECRET_MAX_LENGTH = 512;
const EVENT_NAME = /^[a-z][a-z0-9_]{0,127}$/;

export interface InstantlyWebhookPayload {
  eventType: string;
  campaignId: string;
  timestamp?: string;
  workspace?: string;
  campaignName?: string;
  leadEmail?: string;
  emailAccount?: string;
  uniboxUrl?: string;
  step?: number;
  variant?: number;
  isFirst?: boolean;
  emailId?: string;
  emailSubject?: string;
  emailText?: string;
  emailHtml?: string;
  replyTextSnippet?: string;
  replySubject?: string;
  replyText?: string;
  replyHtml?: string;
}

type Environment = Record<string, string | undefined>;

function configuredSecret(environment: Environment): string | null {
  const candidates = [
    environment[INSTANTLY_WEBHOOK_SECRET_ENV],
    environment[INSTANTLY_WEBHOOK_HEADER_SECRET_ENV],
  ];
  return candidates.find((value) =>
    typeof value === "string"
    && value.length >= SECRET_MIN_LENGTH
    && value.length <= SECRET_MAX_LENGTH
  ) ?? null;
}

export function instantlyWebhookEnabled(environment: Environment = process.env): boolean {
  return environment[INSTANTLY_WEBHOOK_ENABLED_ENV] === "true";
}

export function instantlyWebhookConfigured(environment: Environment = process.env): boolean {
  return configuredSecret(environment) !== null;
}

function headerValue(value: unknown): string | null {
  return typeof value === "string" && value.length <= SECRET_MAX_LENGTH ? value : null;
}

function suppliedWebhookSecrets(headers: Record<string, unknown>): string[] {
  const values: string[] = [];
  const authorization = headerValue(headers.authorization);
  if (authorization) {
    const match = authorization.match(/^Bearer (.+)$/i);
    if (match?.[1]) values.push(match[1]);
  }
  const customHeader = headerValue(
    headers["x-instantly-webhook-secret"] ?? headers["X-Instantly-Webhook-Secret"],
  );
  if (customHeader) values.push(customHeader);
  return values;
}

/**
 * Instantly documents custom webhook headers (including Authorization: Bearer)
 * rather than a provider-generated signing signature. Compare fixed-size
 * digests so malformed or differently-sized credentials never reach
 * timingSafeEqual directly.
 */
export function hasValidInstantlyWebhookSecret(
  headers: Record<string, unknown>,
  environment: Environment = process.env,
): boolean {
  const expected = configuredSecret(environment);
  const expectedDigest = createHash("sha256").update(expected ?? "").digest();
  let matched = false;
  for (const supplied of suppliedWebhookSecrets(headers)) {
    const suppliedDigest = createHash("sha256").update(supplied).digest();
    const equal = timingSafeEqual(expectedDigest, suppliedDigest);
    const candidateMatched = expected !== null && equal;
    matched = candidateMatched || matched;
  }
  return matched;
}

function optionalText(
  source: Record<string, unknown>,
  key: string,
  maxLength = MAX_INSTANTLY_WEBHOOK_TEXT_CHARS,
): string | undefined | null {
  const value = source[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function optionalInteger(
  source: Record<string, unknown>,
  key: string,
): number | undefined | null {
  const value = source[key];
  if (value === undefined) return undefined;
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 100_000
    ? value
    : null;
}

/**
 * Validate only the provider event envelope. Reply text and lead fields are
 * hints and are intentionally never used to identify a restaurant or change a
 * status. The provider campaign ID is validated for shape, then reconciliation
 * fetches authenticated messages and uses the durable local campaign mapping.
 */
export function parseInstantlyWebhookPayload(
  input: unknown,
): InstantlyWebhookPayload | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const source = input as Record<string, unknown>;
  const eventType = source.event_type;
  const campaignId = source.campaign_id;
  if (
    typeof eventType !== "string"
    || !EVENT_NAME.test(eventType)
    || !validInstantlyProviderId(campaignId)
  ) {
    return null;
  }

  const fields: Array<[string, number | undefined]> = [
    ["timestamp", 256],
    ["workspace", 256],
    ["campaign_name", 500],
    ["lead_email", 320],
    ["email_account", 320],
    ["unibox_url", 2_048],
    ["email_id", 256],
    ["email_subject", 500],
    ["email_text", MAX_INSTANTLY_WEBHOOK_TEXT_CHARS],
    ["email_html", MAX_INSTANTLY_WEBHOOK_TEXT_CHARS],
    ["reply_text_snippet", MAX_INSTANTLY_WEBHOOK_TEXT_CHARS],
    ["reply_subject", 500],
    ["reply_text", MAX_INSTANTLY_WEBHOOK_TEXT_CHARS],
    ["reply_html", MAX_INSTANTLY_WEBHOOK_TEXT_CHARS],
  ];
  const values: Record<string, string | undefined> = {};
  for (const [key, maxLength] of fields) {
    const value = optionalText(source, key, maxLength);
    if (value === null) return null;
    values[key] = value;
  }

  const step = optionalInteger(source, "step");
  const variant = optionalInteger(source, "variant");
  if (step === null || variant === null) return null;
  const isFirst = source.is_first;
  if (isFirst !== undefined && typeof isFirst !== "boolean") return null;

  return {
    eventType,
    campaignId,
    ...(values.timestamp !== undefined ? { timestamp: values.timestamp } : {}),
    ...(values.workspace !== undefined ? { workspace: values.workspace } : {}),
    ...(values.campaign_name !== undefined ? { campaignName: values.campaign_name } : {}),
    ...(values.lead_email !== undefined ? { leadEmail: values.lead_email } : {}),
    ...(values.email_account !== undefined ? { emailAccount: values.email_account } : {}),
    ...(values.unibox_url !== undefined ? { uniboxUrl: values.unibox_url } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(variant !== undefined ? { variant } : {}),
    ...(isFirst !== undefined ? { isFirst } : {}),
    ...(values.email_id !== undefined ? { emailId: values.email_id } : {}),
    ...(values.email_subject !== undefined ? { emailSubject: values.email_subject } : {}),
    ...(values.email_text !== undefined ? { emailText: values.email_text } : {}),
    ...(values.email_html !== undefined ? { emailHtml: values.email_html } : {}),
    ...(values.reply_text_snippet !== undefined ? { replyTextSnippet: values.reply_text_snippet } : {}),
    ...(values.reply_subject !== undefined ? { replySubject: values.reply_subject } : {}),
    ...(values.reply_text !== undefined ? { replyText: values.reply_text } : {}),
    ...(values.reply_html !== undefined ? { replyHtml: values.reply_html } : {}),
  };
}