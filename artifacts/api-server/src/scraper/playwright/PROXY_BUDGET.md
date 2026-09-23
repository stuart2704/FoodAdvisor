# Optional browser proxy budget

Browser scanning remains disabled by default. No proxy credentials, account
changes, live browser scans or paid requests were used to implement this guard.
The official Places importer, its £25 budget, explicit confirmation and disabled
startup behavior are unchanged. This is a separate **USD lifetime allowance**,
not a GBP conversion or part of the Places ledger.

## Provider and pricing research (2026-09-23)

The supported provider for this optional path is **Bright Data**, using the
`brd.superproxy.io` gateway. Do not substitute other endpoints without implementing
and verifying their billing contract.

Public PAYG bandwidth prices:

| Lane | Product | USD per GB | Source |
| --- | --- | --- | --- |
| maps | Residential PAYG | $8 regular; $4 temporary coupon offer | https://brightdata.com/pricing/proxy-network/residential-proxies |
| website | Datacenter bandwidth PAYG | $0.60 | https://brightdata.com/pricing/proxy-network/datacenter-proxies |

The residential figure was read from the official page's `data-usd` attributes
(`8` regular, `4` promotional); datacenter $0.60 appears in the official page's
indexed pricing text. The accessible rendered pricing text uses animated digit
strips and is not itself a reliable numeric extraction. Do not use the initial
research suggestion of $8.40/$1.10: current official evidence differs.

These are public bandwidth prices, **not an authenticated account quote**. Do not
use discounts, volume commitments, dedicated-IP monthly prices or free-trial
credits to reduce a reservation. Confirm the actual zone/product, decimal GB
billing unit, upload/download accounting, taxes, minimums and other fees with the
provider before supplying pricing. USD is binding; advertised GBP equivalents
are indicative. No rates or spending allowance are enabled by default.

## Why the full session charge must be established

The gateway caps forwarded traffic at 16 MiB, requests at 100 and browser lifetime
at 120 seconds. Those limits are **not a provider invoice meter**. Upstream
buffering, failed CONNECT requests, TLS overhead and traffic arriving after a
local cutoff may still be billed. Multiplying 16 MiB by a GB price alone would
give false assurance of a hard monetary cap.

This guard therefore requires a verified **provider-enforced maximum charge per
session**, inclusive of those effects and fees. Public PAYG pricing alone does
not establish such a ceiling. `ceilingEvidence` is an operator attestation/reference
to that external control, not an API verification. **Do not invent a ceiling,
use an estimated safety multiplier, or treat an alert as a hard limit.** If the
provider cannot enforce that maximum for the configured credentials/zone and all
requests in a session, leave the pricing unset and browser scanning disabled.
Provider-side account limits and disabled automatic recharge are also recommended,
but a shared account balance alone is not a per-session ceiling.

## Configuration and deployment

Apply `lib/db/migrations/0006_scraper_proxy_budget.sql` explicitly through the
project's existing database migration process before enablement. Runtime does
not create tables or reset the ledger. Missing schema or database errors block
scans. Runtime uses the shared `@workspace/db` Neon-first pool; it creates no
separate production connection.

Server-side configuration (no credentials in this file or chat):

- `SCRAPER_PROXY_BUDGET_USD_MICROS`: positive integer lifetime USD allowance;
  one dollar is 1,000,000 microdollars. There is deliberately no default.
- `SCRAPER_PROXY_PRICING_JSON`: object with separate `maps` and `website` policies.
  Each policy requires `provider: "brightdata"`, `currency: "USD"`,
  `usdMicrosPerGB`, `sessionCeilingMicros`, ISO `verifiedAt` and `validUntil`, and
  a non-secret `ceilingEvidence` reference. No sample active policy is supplied,
  because an enforceable provider ceiling has not yet been established.
- Verification must be in the past and validity in the future, with a maximum
  30-day validity window. The session ceiling must at least cover 16 MiB at the
  verified rate, rounded up to a microdollar, and fit within the configured cap.
- Existing proxy pool configuration, enable flag and explicit scan confirmation
  are still required. A budget does not enable the scanner.

Before any gateway or browser is opened, a transaction conditionally increments
the singleton ledger row and inserts the reservation with its pricing snapshot.
PostgreSQL row locking serializes all processes and both lanes against the same
remaining allowance. No in-memory-only budget or read-then-write balance check.

Reservations remain consumed after success, failure, timeout, process restart
or an uncertain commit. There is no automatic refund, retry, expiry, daily reset
or rollover. This intentionally overestimates spending. Amounts are allowances,
not claims about actual invoiced charges. A lost COMMIT acknowledgement blocks the
scan even if its reservation committed.

Changing configuration cannot raise an established database cap or erase usage.
Lower configured caps constrain subsequent reservations immediately. Any budget
increase or recovery of unused reservations requires an explicit, audited
operator reconciliation against authoritative provider billing; there is no
public reset endpoint. Never delete the ledger to make scanning work.

## Offline verification

Run from the workspace root:

```
node --test artifacts/api-server/src/scraper/playwright/*.test.mjs
```

The budget integration test creates a temporary PostgreSQL cluster over an
isolated Unix socket (requires `initdb` and `pg_ctl`), never reads database
credentials and forbids importing the live database pool. It exercises real
concurrent SQL reservations, missing schema, persisted exhaustion and attempts
to increase a cap through configuration. Launcher fixtures cover budget denial
before networking and retained reservations after failed browser setup.