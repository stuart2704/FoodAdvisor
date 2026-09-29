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

For a Facebook Page OAuth app, Meta's **Other → Business app type** creation route exposed **Add Product → Facebook Login for Business**, whereas the Page-use-case app did not expose that menu. A User access token configuration disables the Assets step, but offers Page permissions by scrolling the alphabetical permissions dropdown; its search did not find them in this dashboard.

**Why:** Repeatedly looking for Add Product in a Page-use-case app led nowhere; the Business-type app route and scrolling the dropdown reached the required configuration.

**How to apply:** Check the app type before giving menu instructions. Don't create another Page-use-case app, don't treat the disabled Assets step as a blocker for User access tokens, and verify the actual permission list before claiming a scope is unavailable.

When Facebook Login for Business uses a configuration ID, let that dashboard configuration supply the permissions; Meta recommends not sending an additional `scope` parameter. A return to the app's callback rules out a blocked redirect but does not distinguish token exchange from Page-list permission failure.

**Why:** Meta's Business Login documentation replaces scope with config_id, and a generic callback error obscured three failed Page-connection attempts despite successful callback routing.

**How to apply:** Diagnose the token exchange and Page-list stages separately, logging only safe numeric provider error identifiers. Never log OAuth codes, app secrets, tokens or provider response bodies.

Meta OAuth error code 1 alone is ambiguous. A separate `client_credentials` token request can check whether the configured Facebook app ID and secret are a valid pair without requiring a user login code; inspect only a narrow allowlisted result, never print the response or request URL.

**Why:** The production code exchange returned code 1, while the workspace's independent credential check returned the same code and Meta's exact “Error validating client secret” response. That points to mismatched app credentials, but does not prove production and development hold identical secret values.

**How to apply:** Ask for a corrected ID/secret pair from the same Business app through the secrets flow; don't mistake a Replit Facebook connector for the product's own app credentials. Retry production login only after the corrected pair is published.

Use a public, human-readable deletion-instructions page in Meta's **Data Deletion Instructions URL** field. Do not enter that page in the **Data Deletion Request URL** callback field: a callback must accept and verify Meta's signed POST, initiate deletion, and return a status URL and confirmation code.

**Why:** A static instructions page can explain how to request deletion but cannot fulfil the signed callback protocol.

**How to apply:** Keep the instructions and callback options distinct during Meta app setup. Only claim callback support after implementing and verifying the full request lifecycle.

For Instagram Login, use the Instagram-specific app ID and secret shown under the Instagram API setup, not the general Meta app credentials. Add the live OAuth callback to Business Login's valid redirect URIs, not the webhook callback field. With Standard Access, the Instagram account must accept its Instagram tester invitation before signing in.

**Why:** The wrong app ID produced “Invalid platform app”; the misplaced callback produced “Invalid redirect_uri”; an unaccepted Instagram tester role produced “Insufficient developer role.” The creator then confirmed the website showed “Connected” after correcting these separately.

**How to apply:** Diagnose each Meta error at its corresponding setup boundary rather than re-entering all credentials. The website can display a standing redirect-URI instruction even when the account is connected; do not mistake that help text for another error.

When Meta returns an empty `/me/accounts` list, a direct Page lookup can still find the Page without reporting the login's `CREATE_CONTENT` task. A Page token by itself does not establish publishing access. Meta's Page roles edge may verify tasks for a non-business user, but an empty or inaccessible roles result cannot rule out a business-managed user.

**Why:** A real production login had all requested permission flags but no listed Pages; entering the Page ID found it, yet did not confirm its content task. Meta documents different coverage for Page roles and business-assigned users.

**How to apply:** Never claim the Page is connected based on a direct lookup alone. Match the login's own identity to an explicitly reported `CREATE_CONTENT` task and require a Page token. If Meta withholds task evidence, report it as unverified rather than as proof the creator lacks Page ownership.

Meta documents Page-role identities as Page-scoped person IDs, while a Facebook Login `/me` identity is app-scoped. Do not interpret a failed equality check between these IDs as “no Page role,” and do not connect on an unmatched role's task alone.

**Why:** A live direct Page lookup issued a Page token but lacked tasks; the role fallback reported no matching login role. Meta's role documentation describes a different ID scope, so the fallback cannot establish whether a role exists for the login.

**How to apply:** Verify an authoritative identity mapping or use a Page-specific task result tied to the authenticated login. Without one, leave posting access unverified; never demand repeated OAuth retries to resolve an inherently ambiguous comparison.

Meta's `auth_type=rerequest` re-asks for declined permissions; it is not documented as forcing a fresh Page-selection screen when a permission is already granted. An absent granular target list is an inconclusive diagnostic, not proof of a particular click in the login dialog. Where Business Login uses a configuration ID, new permissions must be added to that Meta configuration; adding them only to an ordinary OAuth `scope` fallback does not change the configured flow.

**Why:** Meta support suggested rerequest and a business permission after identifying a portfolio-owned Page, but its public login documentation describes a narrower rerequest guarantee, and this app's Business Login takes permission choices from Meta's configuration.

**How to apply:** Inspect the actual authorization URL and Meta configuration separately, and confirm Page-scoped tasks from the new login response before enabling publishing. Do not infer a missing selection solely from debugger target IDs.

For the creator's portfolio-owned Facebook Page, adding `business_management` to the active Facebook Login for Business configuration and completing a fresh login led to a confirmed in-app connection. Connection alone does not prove a live post succeeded.

**Why:** Meta support identified Business Portfolio ownership despite the Page being personally managed; the creator then reported that Facebook connected after updating the configuration.

**How to apply:** When a portfolio-owned Page is missing from `/me/accounts`, check the active configuration's business permission before diagnosing Page access as absent. Keep actual publishing verification separate and opt-in.