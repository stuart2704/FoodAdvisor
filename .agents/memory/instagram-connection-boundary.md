---
name: Meta social connection boundary
description: Distinguish external Meta/workspace setup from product-owned Facebook and Instagram account sign-in.
---

Use the product's own Meta Instagram Login flow for Instagram accounts managed inside The Food Advisor. A Replit workspace connector authorization is separate and must not be represented as an in-app connected account or working publisher.

Likewise, creating a Meta developer app or linking a Facebook Page on Meta's website does not connect the Page inside The Food Advisor. The product's own Facebook Page login requires the Meta app's Facebook-specific credentials and permissions; do not substitute the Instagram product's app ID/secret or imply that a workspace connector completes this link.

**Why:** The creator tried the workspace connector, encountered an authorization rejection, and chose the app-owned Meta route for the product. Later, Meta developer setup alone was mistaken for an in-app connection. Neither that setup nor a successful workspace authorization completes an admin's in-app connection.

**How to apply:** When building Facebook or Instagram publishing, refresh, or account management, continue from the product's Meta OAuth credentials and encrypted per-account token lifecycle. Keep automatic publishing separate and opt-in. Do not use a workspace connector proposal as a substitute for the app's connection button.

When helping someone link an Instagram profile to a Facebook Page in Meta, distinguish Instagram's desktop **Edit Profile** and Accounts Center **Sharing across profiles** from the mobile app's **Edit profile → Page** control. Sharing to a personal Facebook profile is not a Page link. The creator's current Meta use-case dashboards did not expose the documented Facebook Login for Business menu, even after creating another Page-use-case app; do not promise that duplicating the app will reveal it.

**Why:** Meta's published navigation did not match the observed dashboard, and repeated guidance toward add-use-case menus or a new app did not reach the missing login settings.

**How to apply:** Ground the next click in the user's visible Meta interface. For Page-to-Instagram linking, use Meta's mobile instructions and check asset/portfolio permissions if linking reports insufficient access. For product OAuth, be explicit that a Meta-side link does not authorize The Food Advisor.

For Instagram Login, use the Instagram-specific app ID and secret shown under the Instagram API setup, not the general Meta app credentials. Add the live OAuth callback to Business Login's valid redirect URIs, not the webhook callback field. With Standard Access, the Instagram account must accept its Instagram tester invitation before signing in.

**Why:** The wrong app ID produced “Invalid platform app”; the misplaced callback produced “Invalid redirect_uri”; an unaccepted Instagram tester role produced “Insufficient developer role.” The creator then confirmed the website showed “Connected” after correcting these separately.

**How to apply:** Diagnose each Meta error at its corresponding setup boundary rather than re-entering all credentials. The website can display a standing redirect-URI instruction even when the account is connected; do not mistake that help text for another error.