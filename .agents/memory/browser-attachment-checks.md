---
name: Browser attachment checks
description: Browser-level verification of attachment downloads using Playwright and Chromium.
---

Chromium can emit an attachment through Playwright's download event without a corresponding page response event. Do not wait for both events when testing a download.

**Why:** Waiting for a page response timed out even though the calendar attachment was successfully downloaded.

**How to apply:** Wait for the download event while clicking, inspect the resulting file and filename, then make a separate same-context request for status and response headers if needed. Avoid comparing entire dynamic files across those two requests when they include generated timestamps.