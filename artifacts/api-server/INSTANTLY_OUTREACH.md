# Instantly outreach

The API server uses the Replit `instantly` connector through
`new ReplitConnectors().proxy("instantly", "/v2/...")`; no API key is stored
in the application.

## Safe enablement

No campaign is created or activated by this change. Initial outreach requires
all of these explicit settings:

- `OUTREACH_ENABLED=true`
- `INSTANTLY_CAMPAIGN_CREATION_ENABLED=true`
- `INSTANTLY_EACCOUNT=<managed sender mailbox>`

`INSTANTLY_CAMPAIGN_ACTIVATION_ENABLED=true` is required before a delivery run
reserves a slot or creates a campaign. Keep that variable unset until the
owner has reviewed the connected Instantly workspace, sender mailbox, and
campaign behavior; this prevents stranded draft/queued campaigns.

Each app-created campaign has exactly one lead, one email step, a one-day UTC
schedule, and Instantly limits of one lead/email. The existing database
advisory lock and `outreach_audit.send_attempt` reservation still impose the
shared maximum of 20 attempts per UTC day. A campaign/lead acknowledgement is
recorded as `instantly_queued` or `instantly_activated`, never as `sent`.
`instantly_sent_messages` records a provider-visible outbound email exactly
once; only then is its actual `timestamp_email` written as a `sent` audit
event and the restaurant's step/count advanced.

## Replies

Set `INSTANTLY_REPLY_POLLING_ENABLED=true` to permit the protected
`POST /api/automation/instantly/replies` endpoint and explicitly requested
daily-cycle reply processing. `INSTANTLY_EACCOUNT` is required. The poll
resumes its durable `next_starting_after` cursor through at most 20 pages of
`GET /v2/emails?email_type=received&eaccount=...&limit=100` per call. It
does not advance a page cursor after a failed classification. After a resumed
tail completes it performs a new top-to-bottom pass before delivery, so new
messages above a saved cursor cannot be skipped.

An incoming email is processed only if its campaign ID is an ID previously
created and stored by this app **and** its actual `from_address_email`,
`to_address_email_list`, and sender mailbox match that durable record.
Subjects, thread IDs, campaign names and custom
variables are never ownership mappings. Provider message IDs are reserved in
`processed_instantly_messages` before classification, so retries are
idempotent and even an unreadable mapped reply blocks later outreach.

## Follow-ups and reconciliation

Before any initial or follow-up campaign is reserved, the delivery lock
requires a complete, resumable Instantly inbox reconciliation. A failure or a
20-page backlog boundary fails closed without creating a campaign. It then
reconciles provider-visible sent messages for each locally mapped campaign.

Email 2 and Email 3 use separate one-lead, one-step campaigns only after the
actual Email 1/2 sent event makes them due (3/7 days, and at least 24 hours
between Email 2 and Email 3). This preserves the shared cap without relying on
an asynchronous multi-step campaign. There is no Gmail sending fallback.

Claims, unsubscribe tokens, and negative replies create durable
campaign-pause intents. The guarded delivery cycle retries
`POST /v2/campaigns/{id}/pause` before any new reservation; a failed pause
fails the cycle closed. A remote provider cannot make pause/recall atomic with
the local claim or opt-out, so a message already handed to Instantly may still
be delivered. The app does not claim a perfect atomic recall guarantee.

The Instantly tables are defined in `@workspace/db`; apply the normal
development/publish schema flow before enabling the feature. Development
tables were created with non-destructive `CREATE TABLE IF NOT EXISTS` /
`CREATE INDEX IF NOT EXISTS`; no production migration was run.