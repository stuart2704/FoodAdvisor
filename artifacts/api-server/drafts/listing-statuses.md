# Proposed lifecycle statuses — draft only

User-supplied labels:

```text
free
outreach_sent
draft_prepared
reply_received
onboarding_started
menu_uploaded_draft
upgraded_preview
checkout_started
upgraded_draft
upgraded
cancelled
```

Not added to the database or existing outreach status adapter.

For future implementation, track outreach, onboarding, menu submission, and subscription/listing state separately: a restaurant can have progress in each at once. This list is not an enforced transition sequence. Draft and preview states must not grant paid benefits or imply that files have been persisted. Outreach sent status requires confirmed provider delivery, not draft preparation or queue acceptance. Checkout initiation is not proof of payment, and cancellation must preserve the free listing.

Exact transition rules remain to be defined before activation.