# Onboarding endpoint — inactive draft

`onboarding.js.txt` preserves the supplied snippet. It is not imported or mounted.

The snippet does not persist the submitted name or email. Its status update would mutate data if enabled, despite the draft-mode comment; the existing outreach status adapter does not support `onboarding_started`.

Before activation:
- Require authorized restaurant ownership through the existing signed invitation/claim flow; a submitted Place ID is not proof of ownership.
- Validate inputs and persist onboarding data before returning a saved message.
- Keep onboarding progress separate from outreach, claim ownership, and payment entitlement state.
- Handle failures explicitly and advance the frontend only after successful persistence.
- Do not enable publishing, payments, or outreach as a side effect of onboarding.

Onboarding does not technically require Stripe. It is on hold because the user requested draft-only work while supplying code.