import { randomUUID } from "node:crypto";
import type { ProxyConfig, ProxyType } from "./proxyService";

export const SESSION_MAX_BYTES = 16 * 1024 * 1024;
const MAX_MONEY = 1_000_000_000_000;
type QueryResult = { rows: Record<string, unknown>[]; rowCount: number | null };
export interface BudgetClient {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}
export interface BudgetPool { connect(): Promise<BudgetClient> }

export interface ProxyPricing {
  provider: "brightdata";
  currency: "USD";
  usdMicrosPerGB: number;
  sessionCeilingMicros: number;
  verifiedAt: string;
  validUntil: string;
  /** Non-secret reference to the provider-enforced maximum bill per session. */
  ceilingEvidence: string;
}

function positiveMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_MONEY;
}

export function readBudgetPolicy(
  type: ProxyType,
  proxy: ProxyConfig,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): { cap: number; pricing: ProxyPricing } {
  try {
    const cap = Number(env.SCRAPER_PROXY_BUDGET_USD_MICROS);
    const policies = JSON.parse(env.SCRAPER_PROXY_PRICING_JSON ?? "");
    const pricing = policies[type] as ProxyPricing;
    const verified = Date.parse(pricing.verifiedAt);
    const expires = Date.parse(pricing.validUntil);
    const host = new URL(proxy.server).hostname;
    if (!positiveMoney(cap) || !pricing || pricing.provider !== "brightdata"
      || pricing.currency !== "USD" || host !== "brd.superproxy.io"
      || !positiveMoney(pricing.usdMicrosPerGB) || !positiveMoney(pricing.sessionCeilingMicros)
      || !Number.isFinite(verified) || !Number.isFinite(expires)
      || verified > now || expires <= now || expires <= verified
      || expires - verified > 30 * 86400_000
      || typeof pricing.ceilingEvidence !== "string"
      || !/^[a-zA-Z0-9 _./:-]{8,200}$/.test(pricing.ceilingEvidence)
      || BigInt(pricing.sessionCeilingMicros) < (
        BigInt(SESSION_MAX_BYTES) * BigInt(pricing.usdMicrosPerGB) + 999_999_999n
      ) / 1_000_000_000n
      || pricing.sessionCeilingMicros > cap) throw new Error();
    // Persist only the validated tariff fields, never arbitrary JSON payloads.
    return { cap, pricing: {
      provider: pricing.provider, currency: pricing.currency,
      usdMicrosPerGB: pricing.usdMicrosPerGB, sessionCeilingMicros: pricing.sessionCeilingMicros,
      verifiedAt: pricing.verifiedAt, validUntil: pricing.validUntil,
      ceilingEvidence: pricing.ceilingEvidence,
    } };
  } catch {
    throw new Error("Proxy budget requires current verified USD pricing and a provider-enforced session charge ceiling.");
  }
}

/**
 * Lifetime, shared USD ledger. No automatic reset, expiry or refunds: failed
 * connections and lost acknowledgements can still incur provider charges.
 * A guarded local byte count is NOT an authoritative provider billing meter.
 */
export async function reserveProxyBudget(
  type: ProxyType,
  proxy: ProxyConfig,
  dependencies: { pool?: BudgetPool; env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<string> {
  const { cap, pricing } = readBudgetPolicy(type, proxy, dependencies.env, dependencies.now);
  const pool = dependencies.pool ?? (await import("@workspace/db")).pool;
  let client: BudgetClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(`INSERT INTO scraper_proxy_budget (id, cap_micros, reserved_micros)
      VALUES (1, $1, 0) ON CONFLICT (id) DO NOTHING`, [cap]);
    // The conditional UPDATE takes the row lock. Concurrent processes cannot
    // both spend the same remainder. Config changes never reset prior usage or
    // silently raise a previously established cap.
    const result = await client.query(`UPDATE scraper_proxy_budget
      SET cap_micros = LEAST(cap_micros, $1),
          reserved_micros = reserved_micros + $2
      WHERE id = 1 AND reserved_micros + $2 <= LEAST(cap_micros, $1)
      RETURNING reserved_micros`, [cap, pricing.sessionCeilingMicros]);
    if (result.rowCount !== 1) throw new Error("Budget exhausted.");
    const id = randomUUID();
    await client.query(`INSERT INTO scraper_proxy_reservations
      (id, scan_type, amount_micros, pricing) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, type, pricing.sessionCeilingMicros, JSON.stringify(pricing)]);
    await client.query("COMMIT");
    return id;
  } catch {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { /* No egress on uncertain commit. */ }
    }
    throw new Error("Proxy budget unavailable or exhausted; browser scan blocked.");
  } finally {
    client?.release();
  }
}