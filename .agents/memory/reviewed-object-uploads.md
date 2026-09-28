---
name: Reviewed object uploads
description: Preventing reviewed owner-uploaded images from being replaced with a still-valid signed upload URL.
---

Pin each reviewed image to the storage generation checked at finalization. If the signed PUT URL is reused before expiration, serving must not silently show the overwritten bytes; an unavailable older generation may fail closed instead.

**Why:** A presigned upload URL can remain valid after the application marks an image ready for review or publication. Verifying a MIME signature once does not protect the mutable object from later replacement.

**How to apply:** For any future direct-to-storage upload that becomes public after validation or review, save the verified generation and use it for subsequent reads, or promote the verified bytes to a separate write-protected object before publishing.