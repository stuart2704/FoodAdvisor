---
name: Social publishing safety
description: Operating decisions for scheduled social posts and uncertain provider outcomes.
---

Keep social automation off unless it is explicitly enabled and backed by a reliable scheduler. A schedule saved in the dashboard is configuration, not evidence that a process will run at its appointed minute.

**Why:** An in-process timer on Autoscale can miss scheduled minutes when no instance is running. Separately, a timeout after submitting to a social provider does not prove that the provider rejected the post; automatic retries can create duplicates.

**How to apply:** Use a durable job runner and a single-claim mechanism before promising scheduled publishing in production. A saved ON preference is not proof the server worker is running. On OFF, prevent concurrently selected due posts from being claimed; on reactivation, return overdue posts to drafts so stale work does not publish immediately. Keep explicit admin Publish Now separate. When an external submission has an ambiguous outcome, preserve it for human/provider reconciliation rather than automatically sending it again.