# Social API — inactive draft

`social.js.txt` preserves the supplied router. It is not imported or mounted.

- The generation call supplies only a restaurant name. The current content template needs `specialDish` and `address`, so this call would produce text containing `undefined`.
- The scheduler returns a fixed timestamp and platform list. The router does not persist the post or schedule; its success message is not evidence of a scheduled post.
- Analytics counts and branding settings are static examples, not connected-account data or saved settings.
- Branding GET/POST endpoints requested by the draft UI are absent.
- No social account authorization, publishing, or automatic reply behavior is implemented.

Before activation, implement authorized per-restaurant access, validated inputs, persistent posts and schedules, explicit timezones, real provider integration, and honest success/error responses. Keep demonstration values visibly separate from real analytics.

Resolving Stripe does not automatically enable social publishing. Any future payment gating is separate from provider authorization and explicit activation.