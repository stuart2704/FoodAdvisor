---
name: Instagram connection boundary
description: Distinguish workspace Instagram authorization from the product's own Meta sign-in.
---

Use the product's own Meta Instagram Login flow for Instagram accounts managed inside The Food Advisor. A Replit workspace connector authorization is separate and must not be represented as an in-app connected account or working publisher.

**Why:** The creator tried the workspace connector, encountered an authorization rejection, and chose the app-owned Meta route for the product. Even a successful workspace authorization would not complete an admin's in-app connection.

**How to apply:** When building Instagram publishing, refresh, or account management, continue from the product's Meta OAuth credentials and encrypted per-account token lifecycle. Keep automatic publishing separate and opt-in. Do not use a workspace connector proposal as a substitute for the app's connection button.