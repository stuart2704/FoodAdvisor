import { logger } from "../lib/logger";

// Always record alerts locally; optionally deliver through a Slack webhook.
// Pass fixed operational messages, never tokens or raw provider errors.
export async function sendAlert(message: string): Promise<void> {
  logger.error({ alert: true, source: "gmail-watch" }, message);
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    logger.warn("Slack webhook is not configured; alert recorded in server logs only.");
    return;
  }

  try {
    const url = new URL(webhook);
    if (
      url.protocol !== "https:" ||
      !["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !url.pathname.startsWith("/services/") ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid Slack webhook configuration.");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `⚠️ ${message}` }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if (!response.ok || (await response.text()).trim() !== "ok") {
      throw new Error("Slack rejected the alert.");
    }
    logger.info("Gmail watch alert delivered to Slack.");
  } catch {
    // Webhook URLs are credentials: never log the URL or raw fetch error.
    logger.error("Slack alert delivery failed; the alert remains in server logs.");
    throw new Error("Slack alert delivery failed.");
  }
}