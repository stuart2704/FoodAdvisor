---
name: Outbound URL verification
description: Security rule for server-side requests to user-controlled URLs.
---

Validating a hostname with DNS before making a normal hostname-based request is not sufficient SSRF protection. Pin the request socket to an address from the validated public DNS result while preserving the original hostname for Host and TLS/SNI checks. Repeat this for every redirect hop.

**Why:** A hostile DNS server can return a public address during validation and a private address when the HTTP client resolves the same hostname again, creating a time-of-check/time-of-use gap.

**How to apply:** Any feature that probes a user-controlled URL must either use a pinned lookup/connection per hop or an egress client that validates the actual connected remote address. Include a regression test that models DNS changing between validation and connection.