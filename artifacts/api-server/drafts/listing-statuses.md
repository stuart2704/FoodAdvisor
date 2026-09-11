# Proposed listing and menu statuses — draft only

User-supplied labels:

```text
free
checkout_started
upgraded_draft
upgraded
cancelled
menu_uploaded_draft
menu_uploaded
```

Not added to the database or existing outreach status adapter.

For future implementation, keep subscription/listing state separate from menu submission state: a restaurant can be free or upgraded while also having a menu submission. Draft states must not grant paid benefits or imply that files have been persisted. Checkout initiation is not proof of payment, and cancellation must preserve the free listing.

Exact transition rules remain to be defined before activation.