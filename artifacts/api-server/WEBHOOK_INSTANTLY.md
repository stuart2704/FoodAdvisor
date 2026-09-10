# Instantly reply webhook

This server accepts an Instantly `reply_received` webhook as a delivery hint.
It does **not** trust a restaurant ID, subject, campaign name, lead field, or
custom variable from the webhook body. After authentication, the handler runs
the existing bounded `reconcileInstantlyInboxFully()` flow. That flow fetches
the managed provider inbox through the Instantly connector, checks the
durable campaign/eaccount/from/to mapping, and reserves the provider message
ID transactionally before classification. Re-delivery is therefore
idempotent, and an incomplete page or classification remains retryable.

## Configuration

The feature is fail-closed:

- `INSTANTLY_WEBHOOK_ENABLED=true` is required. It defaults to disabled.
- `INSTANTLY_WEBHOOK_SECRET` must be configured as a server secret and be at
  least 32 characters. `INSTANTLY_WEBHOOK_HEADER_SECRET` is accepted as an
  alternate environment key.
- No Instantly API credential is stored in this application and this change
  does not register a provider webhook, create a campaign, activate a
  campaign, or send an email.

The secret is sent using the custom header mechanism documented by Instantly:

```text
Authorization: Bearer <configured-secret>
```

The equivalent `X-Instantly-Webhook-Secret` header is also accepted for
providers configured with a named custom header. The secret must never be put
in a URL or query string.

## Endpoints

Both aliases use the same authenticated handler:

- `POST /api/webhooks/instantly`
- `POST /webhooks/instantly`

The body is limited to 64 KiB and requests are rate limited to 60 per minute
per source address after authentication. Missing or invalid credentials are
rejected before any provider connector or database query. With no configured
secret the endpoint returns `503` so an operator can configure it without
silently losing a provider delivery. A disabled feature returns `404`.

Valid non-reply events are acknowledged without changing local state. A valid
`reply_received` event returns `204` only after reconciliation succeeds. A
provider, pagination, database, or classification failure returns `503`; the
webhook is intentionally not acknowledged so Instantly can retry it.

## Provider payload

The parser follows the current Instantly webhook event schema, including:

- `event_type: "reply_received"`
- `timestamp`, `workspace`, `campaign_id`, `campaign_name`
- `lead_email`, `email_account`, `unibox_url`
- `reply_text_snippet`, `reply_subject`, `reply_text`, `reply_html`

These values are bounded and used only to validate the event envelope. The
authenticated reconciliation fetch is the source of truth.

Official references:

- [Instantly webhook events](https://developer.instantly.ai/guides/webhook-events)
- [Instantly webhooks](https://help.instantly.ai/en/articles/6261906-webhooks)
- [Instantly webhook API reference](https://developer.instantly.ai/api-reference/groups/webhook)