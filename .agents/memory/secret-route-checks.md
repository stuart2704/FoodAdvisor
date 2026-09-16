---
name: Secret-protected route checks
description: Limits of shell-based verification for endpoints protected by stored workflow secrets.
---

Do not expect stored Replit workflow secrets to be retrievable or reusable from an arbitrary shell command when testing a protected endpoint. Verify secret existence separately and use shell requests only for unauthenticated-denial checks unless an approved authenticated caller is available.

**Why:** Repeated shell attempts could confirm that the route denied unauthorized access but could not supply the stored automation credential for a successful request. Treating that as an application authentication failure would be misleading.

**How to apply:** Confirm route compilation, clean workflow startup, secret existence, validation behavior, and 401 denial independently. Perform the successful live request through the real scheduler or another authorized application path without exposing credentials.