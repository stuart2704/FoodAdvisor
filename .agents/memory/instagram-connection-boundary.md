---
name: Meta social connection boundary
description: Distinguish external Meta/workspace setup from product-owned Facebook and Instagram account sign-in.
---

Use the product's own Meta Instagram Login flow for Instagram accounts managed inside The Food Advisor. A Replit workspace connector authorization is separate and must not be represented as an in-app connected account or working publisher.

Likewise, creating a Meta developer app or linking a Facebook Page on Meta's website does not connect the Page inside The Food Advisor. The product's own Facebook Page login requires the Meta app's Facebook-specific credentials and permissions; do not substitute the Instagram product's app ID/secret or imply that a workspace connector completes this link.

**Why:** The creator tried the workspace connector, encountered an authorization rejection, and chose the app-owned Meta route for the product. Later, Meta developer setup alone was mistaken for an in-app connection. Neither that setup nor a successful workspace authorization completes an admin's in-app connection.

**How to apply:** When building Facebook or Instagram publishing, refresh, or account management, continue from the product's Meta OAuth credentials and encrypted per-account token lifecycle. Keep automatic publishing separate and opt-in. Do not use a workspace connector proposal as a substitute for the app's connection button.