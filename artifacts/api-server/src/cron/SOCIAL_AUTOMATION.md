# External social publishing schedule

The API has no social timer. GitHub Actions runs `.github/workflows/social-automation.yml`
every five minutes and POSTs to the published API at `/api/automation/social`.
The request wakes an idle Autoscale API. The job can arrive late; today's due
UTC slots are caught up when it does. GitHub scheduled workflows are best-effort,
not an exact-minute delivery guarantee. If GitHub misses an entire UTC day,
inspect the queue and decide manually whether to publish old content.

## Activate (production only)

1. Publish the API with the additive `lib/db/migrations/0035_social_schedule_assignment.sql`
   schema change applied to its database. Leave the master automation switch OFF.
2. Set the API's `AUTOMATION_TOKEN` (at least 32 characters) and
   `SOCIAL_AUTOMATION_ENABLED=true` in the published environment. This flag
   enables authenticated requests; it does **not** start a timer.
3. Push the workflow to the GitHub repository's **default branch**. Set Actions secret
   `SOCIAL_AUTOMATION_TOKEN` to the same token. Set Actions variables
   `SOCIAL_AUTOMATION_URL` to the published HTTPS URL ending in
   `/api/automation/social` and `SOCIAL_SCHEDULER_ENABLED=true`. Never point
   the job at the development preview. If the published app is private, configure
   production external access for GitHub Actions before expecting requests to
   reach the API.
4. With master automation still OFF, dispatch the workflow manually. Check
   that it returns `{"outcome":"ran"}`; `busy` means another cycle held the
   cross-replica lock. Check a scheduled execution also succeeds before setting
   `SOCIAL_EXTERNAL_SCHEDULER_VERIFIED=true` in the published API environment.
   This is an operator confirmation gate, not an automatic liveness probe.
   Then turn the master switch ON. Add a connected Facebook Page and a daily UTC
   schedule. Turning master ON returns already-overdue scheduled posts to
   drafts rather than submitting old posts immediately.
5. Monitor failed workflow runs and the social publishing logs. A row left
   `publishing` or marked `failed` after Facebook was contacted must be
   reconciled against the Page before any manual repeat. Do not automatically
   retry ambiguous submissions.

To stop new automatic claims, turn master automation OFF; to disable the
external caller, also set `SOCIAL_SCHEDULER_ENABLED=false`. A provider request
already in flight may still finish. The API's `workerConfigured` field only
reports the operator-confirmed gates and does not dynamically verify that
GitHub Actions is still running.